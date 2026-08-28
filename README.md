# Bookshelf

A static, data-driven record of books read and highlights saved.

## Data

`_data/books.json` is the generated source archive and is excluded from the rendered site. The public index reads the lightweight
`static/data/catalog.json`, and each book page loads its own file from `static/data/highlights/`.

Import a full Goodreads library export once:

```sh
node scripts/sync-books.mjs --replace --goodreads-csv /path/to/goodreads_library_export.csv
```

Fetch recent Goodreads changes and Readwise highlights locally:

```sh
GOODREADS_RSS_URL="..." READWISE_TOKEN="..." node scripts/sync-books.mjs
```

All matched Readwise highlights are published by the scheduled sync.
Readwise Reader PDFs are considered too, even when Readwise categorizes them as articles. Translated or otherwise renamed Reader documents can be mapped to their Goodreads record in `_data/readwise-matches.json`.

Books from the original hand-maintained site are retained without dates after the Goodreads history, including during a full CSV replacement.

`_data/formative-works.json` contains the hand-picked formative works published at `/formative-works/`. Each entry uses the source book ID so catalog syncs can update titles without losing the selection. The public-data build fails if an ID is duplicated or no longer exists.

Rebuild the public catalog and per-book files without fetching remote data:

```sh
node scripts/sync-books.mjs --build-public-data
```

## Automation

The daily GitHub Action needs these repository secrets:

- `GOODREADS_RSS_URL`: the `#ALL#` Goodreads bookshelf RSS URL
- `READWISE_TOKEN`: a token from `https://readwise.io/access_token`

The action merges changes into the source archive, rebuilds the public data, and commits only when it changes.
For existing records, RSS updates ratings, status, and read dates without replacing the original Goodreads `Date Added` value.

## Local preview

Serve the repository root rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

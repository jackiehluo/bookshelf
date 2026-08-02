# Bookshelf

A static, data-driven record of books read and highlights saved.

## Data

`static/data/books.json` is the generated source archive. The public index reads the lightweight
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
Readwise Reader PDFs are considered too, even when Readwise categorizes them as articles. Translated or otherwise renamed Reader documents can be mapped to their Goodreads record in `static/data/readwise-matches.json`.

Books from the original hand-maintained site are retained without dates after the Goodreads history, including during a full CSV replacement.

Rebuild the public catalog and per-book files without fetching remote data:

```sh
node scripts/sync-books.mjs --build-public-data
```

## Automation

The weekly GitHub Action needs these repository secrets:

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

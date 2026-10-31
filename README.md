# Bookshelf

A static, data-driven record of books read and highlights saved.

## Data

`_data/books.json` is the generated source archive and is excluded from the rendered site. The public index reads the lightweight
`static/data/catalog.json`, and each book page loads its own file from `static/data/highlights/`.

Import a full Goodreads library export once:

```sh
node scripts/sync-books.mjs --replace --goodreads-csv /path/to/goodreads_library_export.csv
```

Fetch reading metadata from Readwise Books and highlights from Readwise Highlights:

```sh
READWISE_TOKEN="..." node scripts/sync-books.mjs
```

The sync publishes finished, currently reading, and did-not-finish books. Wanted, unsorted, and deleted entries are excluded from new imports. Existing archive entries are retained when absent from those shelves, including paused books, which Readwise Books does not currently support.

Existing book IDs, titles, URLs, covers, highlights, and original dates added are preserved. On the first Readwise Books match, existing ratings and read dates take precedence over imported values. `sourceState.readwiseBooks` records the imported values so subsequent edits in Readwise Books can update ratings and read dates without repeatedly overwriting historical differences. This state stays out of the public catalog.

`_data/readwise-books-matches.json` maps Readwise Books IDs to archive IDs for renamed titles and edition differences. Duplicate entries use the existing linked record, or the record with the most date and rating information on the first sync. Existing highlights identifiers remain separate from Readwise Books identifiers.

All matched Readwise highlights are published by the scheduled sync.
Readwise Reader PDFs are considered too, even when Readwise categorizes them as articles. Translated or otherwise renamed Reader documents can be mapped to their Goodreads record in `_data/readwise-matches.json`.

Books from the original hand-maintained site are retained without dates after the Goodreads history, including during a full CSV replacement.

`_data/formative-works.json` contains the hand-picked formative works published at `/formative-works/`. Each entry uses the source book ID so catalog syncs can update titles without losing the selection. The public-data build fails if an ID is duplicated or no longer exists.

Rebuild the public catalog and per-book files without fetching remote data:

```sh
node scripts/sync-books.mjs --build-public-data
```

## Automation

The daily GitHub Action needs one repository secret:

- `READWISE_TOKEN`: a token from `https://readwise.io/access_token`

The account must have access to Readwise Books. Each daily run reads the public Goodreads shelf widgets, updates Readwise Books, then fetches the Readwise library and highlights to rebuild the site. Goodreads is authoritative for shelf status and ratings. No Goodreads login cookie or API key is needed; `GOODREADS_USER_ID` is the public profile ID configured in the workflow.

The widget exposes the 100 most recently updated books on each of `currently-reading`, `read`, `did-not-finish`, and `to-read`. This is an incremental feed over the existing imported history, not a complete library export. Changes beyond that window, removals, and private profiles cannot be detected. Goodreads can cache widgets, so changes may take another run to appear. Reading dates and reviews are not supplied and stay unchanged. Paused books remain in the archive because Readwise has no matching shelf.

`_data/goodreads-readwise-matches.json` binds Goodreads review IDs to Readwise Books IDs across title and edition changes. Ambiguous books require an explicit binding; the job reports an error rather than merging sequels or inventing dates. Books absent from the widgets are retained. Goodreads RSS is no longer used. CSV import remains available for archive recovery.

Preview the Goodreads bridge without changing Readwise or local files:

```sh
GOODREADS_USER_ID=65165202 READWISE_TOKEN="..." node scripts/sync-goodreads-readwise.mjs
```

Add `--apply` to update Readwise and verify the resulting library. The daily action uses this mode before the existing site sync.

Compare Readwise Books with the archive without changing files:

```sh
READWISE_TOKEN="..." node scripts/compare-readwise-books.mjs
```

The comparison checks archive IDs, public URLs, highlights, historical read dates, and repeatability, then lists additions and metadata changes. To repeat the comparison offline, pass a JSON file containing the raw array of Readwise Books entries as the first argument.

## Local preview

Serve the repository root rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

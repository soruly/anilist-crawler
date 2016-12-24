# anilist-crawler
Crawl data from anilist API and store in elasticsearch.

## Data collected
- anime
- character
- staff

## How to use
`git clone https://github.com/soruly/anilist-crawler.git`

copy `config.sample.js` and rename to `config.js`

Modify `config.js` to fill in your client_id and client_secret (get one from https://anilist.co/settings/developer)

`node index.js --anime [animeID]`

`node index.js --page [pageNumber]`

For details of the API please visit https://github.com/joshstar/AniList-API-Docs

## Notes
- anime IDs are discovered from the /anime/browse endpoint
- character and staff IDs are discovered from the crawled anime

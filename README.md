# anilist-crawler
[![](https://david-dm.org/soruly/anilist-crawler/status.svg)](https://david-dm.org/soruly/anilist-crawler)

Crawl data from anilist API and store in elasticsearch.

## Data collected
- anime
- character
- staff

## Requirements
- Node.js 6.9+
- elasticsearch 5.0+

## How to use
`git clone https://github.com/soruly/anilist-crawler.git`

copy `config.sample.js` and rename to `config.js`

Modify `config.js` to fill in your client_id and client_secret (get one from https://anilist.co/settings/developer)

Example

Fetch anime ID 123

`node index.js --anime 123`


Fetch all anime in page 240

`node index.js --page 240`


Fetch all anime from page 240 to 244 (inclusive)

`node index.js --page 240-244`


Fetch all anime from page 240 to the last page

`node index.js --page 240-`


For details of the API please visit https://github.com/joshstar/AniList-API-Docs

## Notes
- anime IDs are discovered from the /anime/browse endpoint
- character and staff IDs are discovered from the crawled anime
- elasticsearch 2.x does not support having . (dot) in field name. It would fail as `airing_stats` may use episode numbers like 13.5 as keys.

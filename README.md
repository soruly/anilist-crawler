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


Find anime that has been deleted on anilist, but have not been deleted locally in elasticsearch

`node index.js --cleanup`

For details of the API please visit https://github.com/joshstar/AniList-API-Docs

## Notes
- anime IDs are discovered from the /anime/browse endpoint
- character and staff IDs are discovered from the crawled anime
- airing_stats is removed from anime because it cause quite a lot of trouble in elasticsearch
- to increase number of fields in elasticsearch, you can run
`curl -XPUT http://127.0.0.1:9200/your_index/_settings -d'{"index.mapping.total_fields.limit":2000}'`

# anilist-crawler
[![](https://david-dm.org/soruly/anilist-crawler/status.svg)](https://david-dm.org/soruly/anilist-crawler)

Crawl data from anilist API and store in elasticsearch.

## Data collected
- anime
- character
- staff

## Requirements
- Node.js 8.0+
- elasticsearch 5.0+
- MariaDB 10.2+

## How to use
`git clone https://github.com/soruly/anilist-crawler.git`

copy `config.sample.js` and rename to `config.js`

Modify `config.js` to fill in your client_id and client_secret (get one from https://anilist.co/settings/developer)

MariaDB setup SQL script
```
CREATE TABLE anilist (
    id INTEGER UNSIGNED NOT NULL PRIMARY KEY,
    json longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
    CHECK (JSON_VALID(json))
);
```

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

## Anilist APIv2 (beta)
See API docs in https://github.com/AniList/ApiV2-GraphQL-Docs.

Anilist APIv2 supports GraphQL. It is faster because we don't need to send another request for character and staff native name. You can also customize the field for your own need. But you need to learn the GraphQL syntax, which is pretty easy.

You can try the interactive query tool here. https://anilist.co/graphiql

The usage of v2.js is exactly the same as above, just replace index.js with v2.js

`--cleanup` has not been implemented in v2.js yet.

API request limit exceed (HTTP 429) has not been handled yet. With 60 requests/min per IP, it is unlikely to hit the limit with complex qurey.

Access token is not required in Anilist APIv2.

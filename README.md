# anilist-crawler

[![License](https://img.shields.io/github/license/soruly/anilist-crawler.svg?style=flat-square)](https://github.com/soruly/anilist-crawler/blob/master/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/workflow/status/soruly/anilist-crawler/Node.js%20CI?style=flat-square)](https://github.com/soruly/anilist-crawler/actions)

Crawl data from anilist APIv2, store in MariaDB, merge with Chinese data, and optionally store the merged result in elasticsearch.

## Requirements

- Node.js 16.0+
- MariaDB 10.2+
- elasticsearch 5.0+ (optional)

## How to use

`git clone https://github.com/soruly/anilist-crawler.git`

copy `.env.example` and rename to `.env`

Modify `.env` to fill in your mariaDB user and password

Create a MariaDB schema "anilist" for the user

Example

Fetch anime ID 123

`node index.js --anime 123`

Fetch all anime in page 240

`node index.js --page 240`

Fetch all anime from page 240 to 244 (inclusive)

`node index.js --page 240-244`

Fetch all anime from page 240 to the last page

`node index.js --page 240-`

Sometimes anime would be deleted from anilist, but it still exists locally in your database. You can use `--clean` to get a clean copy every time you start crawling.

`node index.js --clean --page 240-`

For details of Anilist API please visit https://github.com/AniList/ApiV2-GraphQL-Docs/

You can try the interactive query tool here. https://anilist.co/graphiql

## Notes

- airing stats is removed from anime because it has too many columns
- to increase number of fields in elasticsearch, you can run
  `curl -XPUT http://127.0.0.1:9200/your_index/_settings -d'{"index.mapping.total_fields.limit":2000}'`
- API request limit exceed (HTTP 429) has not been handled yet. With 60 requests/min per IP, it is unlikely to hit the limit with complex qurey.

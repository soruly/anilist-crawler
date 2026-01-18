# anilist-crawler

[![License](https://img.shields.io/github/license/soruly/anilist-crawler.svg?style=flat-square)](https://github.com/soruly/anilist-crawler/blob/master/LICENSE)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/soruly/anilist-crawler/node.js.yml?style=flat-square)](https://github.com/soruly/anilist-crawler/actions)

Crawl data from [AniList](https://anilist.co/home) API and store as json file.

## Requirements

- Node.js >= 22.18

## How to use

Fetch anime ID 123

`node index.js --anime 123`

Fetch all anime in page 240

`node index.js --page 240`

Fetch all anime from page 240 to 244 (inclusive)

`node index.js --page 240-244`

Fetch all anime from page 240 to the last page

`node index.js --page 240-`

Sometimes anime would be deleted from AniList, but it still exists locally in your database. You can use `--clean` to get a clean copy every time you start crawling.

`node index.js --clean --page 240-`

The output json files are saved to `anilist_anime` folder. You may adjust `query.graphql` to filter out fields that you do not want.

For details of AniList API please visit https://github.com/AniList/ApiV2-GraphQL-Docs/

You can try the interactive query tool here. https://anilist.co/graphiql

## Notes

- Anilist API has rate limit of 60 requests/min per IP address. The script will wait for a while when rate limit is reached.

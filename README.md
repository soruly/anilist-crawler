# anilist-crawler
[![Build Status](https://travis-ci.org/soruly/anilist-crawler.svg?branch=master)](https://travis-ci.org/soruly/anilist-crawler)
[![Dependencies](https://david-dm.org/soruly/anilist-crawler/status.svg)](https://david-dm.org/soruly/anilist-crawler)

Crawl data from anilist APIv2, store in MariaDB, merge with Chinese data, and store in elasticsearch.

## Requirements
- Node.js 8.0+
- elasticsearch 5.0+
- MariaDB 10.2+

## How to use
`git clone https://github.com/soruly/anilist-crawler.git`

copy `.env.example` and rename to `.env`

Modify `.env` to fill in your mariaDB user and password

MariaDB setup SQL script
```
CREATE TABLE `anilist` (
  `id` int(10) UNSIGNED NOT NULL PRIMARY KEY,
  `json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  CHECK (JSON_VALID(`json`))
);


CREATE TABLE `anilist_chinese` (
  `id` int(10) UNSIGNED NOT NULL PRIMARY KEY,
  `json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  CHECK (JSON_VALID(`json`))
);

CREATE VIEW `anilist_view` AS SELECT `anilist`.`id`, JSON_MERGE(`anilist`.`json`, IFNULL(`anilist_chinese`.`json`, JSON_OBJECT('title', JSON_OBJECT('chinese', null), 'synonyms_chinese', JSON_ARRAY()))) AS `json` FROM `anilist` LEFT JOIN `anilist_chinese` ON `anilist`.`id`=`anilist_chinese`.`id`
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

To be completed:  
Find anime that has been deleted on anilist, but have not been deleted locally

`node index.js --cleanup`

For details of Anilist API please visit https://github.com/AniList/ApiV2-GraphQL-Docs/

You can try the interactive query tool here. https://anilist.co/graphiql

## Notes
- airing stats is removed from anime because it has too many columns
- to increase number of fields in elasticsearch, you can run
`curl -XPUT http://127.0.0.1:9200/your_index/_settings -d'{"index.mapping.total_fields.limit":2000}'`
- API request limit exceed (HTTP 429) has not been handled yet. With 60 requests/min per IP, it is unlikely to hit the limit with complex qurey.


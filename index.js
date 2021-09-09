import "dotenv/config.js";
import fs from "fs";
import cluster from "cluster";
import fetch from "node-fetch";
import Knex from "knex";

const {
  DB_HOST,
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_TABLE,
  ELASTICSEARCH_ENDPOINT,
  ANILIST_API_ENDPOINT,
} = process.env;

const q = {};
q.query = fs.readFileSync("query.graphql", "utf8");

const submitQuery = async (query, variables) => {
  query.variables = variables;
  try {
    const response = await fetch(ANILIST_API_ENDPOINT, {
      method: "POST",
      body: JSON.stringify(query),
      headers: { "Content-Type": "application/json" },
    }).then((res) => res.json());
    if (response.errors) {
      console.log(response.errors);
    }
    return response.data;
  } catch (e) {
    console.log(e);
    return null;
  }
};

const getTitle = (title) => (title.native ? title.native : title.romaji);

const perPage = 50;
const numOfWorker = 3;

const knex = Knex({
  client: "mysql",
  connection: {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
  },
});

if (cluster.isMaster) {
  const [arg, value] = process.argv.slice(2);

  if (process.argv.slice(2).includes("--clean")) {
    console.log(`Dropping table ${DB_TABLE} if exists`);
    await knex.schema.dropTableIfExists(DB_TABLE);
    console.log(`Dropped table ${DB_TABLE}`);
  }
  if (!(await knex.schema.hasTable(DB_TABLE))) {
    console.log(`Creating table ${DB_TABLE}`);
    await knex.schema.createTable(DB_TABLE, (table) => {
      table.integer("id").unsigned().notNullable().primary();
      table.json("json").collate("utf8mb4_unicode_ci");
    });
    console.log(`Created table ${DB_TABLE}`);
  }
  if (ELASTICSEARCH_ENDPOINT) {
    if (!(await knex.schema.hasTable("anilist_chinese"))) {
      console.log("Creating table anilist_chinese");
      await knex.schema.createTable("anilist_chinese", (table) => {
        table.integer("id").unsigned().notNullable().primary();
        table.json("json").collate("utf8mb4_unicode_ci");
      });
      console.log("Created table anilist_chinese");
    }
    if (!(await knex.schema.hasTable("anilist_view"))) {
      console.log("Creating table anilist_view");
      await knew.raw(
        "CREATE VIEW `anilist_view` AS SELECT `anilist`.`id`, JSON_MERGE(`anilist`.`json`, IFNULL(`anilist_chinese`.`json`, JSON_OBJECT('title', JSON_OBJECT('chinese', null), 'synonyms_chinese', JSON_ARRAY()))) AS `json` FROM `anilist` LEFT JOIN `anilist_chinese` ON `anilist`.`id`=`anilist_chinese`.`id`"
      );
      console.log("Created table anilist_view");
    }
  }
  knex.destroy();

  if (arg === "--anime" && value) {
    console.log(`Crawling anime ${value}`);
    const anime = (await submitQuery(q, { id: value })).Page.media[0];
    const worker = cluster.fork();
    worker.on("message", (message) => {
      console.log(`Completed anime ${anime.id} (${getTitle(anime.title)})`);
      worker.kill();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    worker.send(anime);
  } else if (arg === "--page" && value) {
    const format = /^(\d+)(-)?(\d+)?$/;
    const startPage = parseInt(value.match(format)[1], 10);
    let lastPage = parseInt(value.match(format)[3], 10);
    if (!value.match(format)[2]) {
      lastPage = startPage;
    } else if (value.match(format)[2] && isNaN(lastPage)) {
      console.log("Looking up last page number");
      lastPage = (
        await submitQuery(q, {
          page: 1,
          perPage,
        })
      ).Page.pageInfo.lastPage;
    }
    console.log(`Crawling page ${startPage}-${lastPage}`);

    let animeList = [];
    let finished = false;

    for (let i = 0; i < numOfWorker; i++) {
      cluster.fork();
    }

    cluster.on("message", (worker, anime) => {
      console.log(`Completed anime ${anime.id} (${getTitle(anime.title)})`);
      if (animeList.length > 0) {
        worker.send(animeList.pop());
      } else if (finished) {
        worker.kill();
      }
    });

    for (let page = startPage; page <= lastPage; page++) {
      console.log(`Crawling page ${page}`);
      animeList = animeList.concat(
        (
          await submitQuery(q, {
            page,
            perPage,
          })
        ).Page.media
      );
      for (const id in cluster.workers) {
        if (animeList.length > 0) {
          cluster.workers[id].send(animeList.pop());
        }
      }
    }
    finished = true;
    console.log(`Crawling complete page ${startPage}-${lastPage}`);
  } else {
    console.log("Usage: node index.js --anime 1");
    console.log("       node index.js --page 1");
    console.log("       node index.js --page 1-");
    console.log("       node index.js --page 1-2");
  }
} else {
  process.on("message", async (anime) => {
    // delete the record from mariadb if already exists
    await knex(DB_TABLE).where({ id: anime.id }).del();

    // store the json to mariadb
    await knex(DB_TABLE).insert({
      id: anime.id,
      json: JSON.stringify(anime),
    });

    if (ELASTICSEARCH_ENDPOINT) {
      // select the data back from mariadb
      // anilist_view is a json combined with anilist_chinese json
      const mergedEntry = await knex("anilist_view").where({ id: anime.id }).select("json");

      // put the json to elasticsearch
      const response = await fetch(`${ELASTICSEARCH_ENDPOINT}/anime/${anime.id}`, {
        method: "PUT",
        body: mergedEntry[0].json,
        headers: { "Content-Type": "application/json" },
      });
    }
    process.send(anime);
  });

  process.on("exit", () => {
    knex.destroy();
  });
}

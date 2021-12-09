import "dotenv/config.js";
import fs from "fs";
import cluster from "cluster";
import fetch from "node-fetch";
import Knex from "knex";

const { DB_HOST, DB_USER, DB_PASS, DB_NAME, DB_TABLE, ES_HOST, ES_PORT, ES_INDEX } = process.env;

const q = {};
q.query = fs.readFileSync("query.graphql", "utf8");

const submitQuery = async (query, variables) => {
  query.variables = variables;
  try {
    const response = await fetch("https://graphql.anilist.co/", {
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

const perPage = 50;
const numOfWorker = 3;

const knex = DB_HOST
  ? Knex({
      client: "mysql",
      connection: {
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME,
      },
    })
  : null;

if (cluster.isPrimary) {
  const [arg, value] = process.argv.slice(2);

  if (knex) {
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
    knex.destroy();
  }

  if (ES_HOST) {
    if (process.argv.slice(2).includes("--clean")) {
      console.log(`Dropping index ${ES_INDEX} if exists`);
      await fetch(`http://${ES_HOST}:${ES_PORT}/${ES_INDEX}`, { method: "DELETE" });
      console.log(`Dropped index ${ES_INDEX}`);
    }
    if ((await fetch(`http://${ES_HOST}:${ES_PORT}/${ES_INDEX}`)).status === 404) {
      console.log(`Creating index ${ES_INDEX}`);
      await fetch(`http://${ES_HOST}:${ES_PORT}/${ES_INDEX}`, {
        method: "PUT",
        body: JSON.stringify({
          settings: {
            index: {
              number_of_shards: 1,
              number_of_replicas: 0,
            },
          },
        }),
        headers: { "Content-Type": "application/json" },
      });
      console.log(`Created index ${ES_INDEX}`);
    }
  }

  if (arg === "--anime" && value) {
    console.log(`Crawling anime ${value}`);
    const anime = (await submitQuery(q, { id: value })).Page.media[0];
    const worker = cluster.fork();
    worker.on("message", (message) => {
      console.log(`Completed anime ${anime.id} (${anime.title.native ?? anime.title.romaji})`);
      worker.kill();
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
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
      console.log(`Completed anime ${anime.id} (${anime.title.native ?? anime.title.romaji})`);
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
    if (knex) {
      // delete the record from mariadb if already exists
      await knex(DB_TABLE).where({ id: anime.id }).del();
      await knex(DB_TABLE).insert({
        id: anime.id,
        json: JSON.stringify(anime),
      });
    }

    if (ES_HOST) {
      const response = await fetch(`http://${ES_HOST}:${ES_PORT}/${ES_INDEX}/anime/${anime.id}`, {
        method: "PUT",
        body: JSON.stringify(anime),
        headers: { "Content-Type": "application/json" },
      });
    }
    process.send(anime);
  });

  process.on("exit", () => {
    if (knex) knex.destroy();
  });
}

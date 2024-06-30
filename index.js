import path from "node:path";
import fs from "node:fs/promises";
import cluster from "node:cluster";
import Knex from "knex";

process.loadEnvFile();
const {
  DB_HOST,
  DB_PORT,
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_TABLE,
  ES_HOST,
  ES_PORT,
  ES_INDEX,
  FS_DIR,
} = process.env;

const q = {};
q.query = await fs.readFile("query.graphql", "utf8");

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
        port: DB_PORT,
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

  if (FS_DIR) {
    await fs.mkdir(FS_DIR, { recursive: true });
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
    const startPage = Number(value.match(format)[1]);
    const lastPage = value.match(format)[2] ? Number(value.match(format)[3]) : startPage;

    console.log(`Crawling page ${startPage} to ${lastPage || "end"}`);

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

    let page = startPage;
    while (!lastPage || page <= lastPage) {
      console.log(`Crawling page ${page}`);
      const res = await submitQuery(q, {
        page,
        perPage,
      });
      animeList = animeList.concat(res.Page.media);
      for (const id in cluster.workers) {
        if (animeList.length > 0) {
          cluster.workers[id].send(animeList.pop());
        }
      }
      if (!res.Page.pageInfo.hasNextPage) break;
      page++;
    }
    finished = true;
    console.log("Crawling complete");
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

    if (FS_DIR) {
      await fs.writeFile(path.join(FS_DIR, `${anime.id}.json`), JSON.stringify(anime, null, 2));
    }

    process.send(anime);
  });

  process.on("exit", () => {
    if (knex) knex.destroy();
  });
}

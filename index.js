require("dotenv").config();
const fs = require("fs");
const cluster = require("cluster");
const fetch = require("node-fetch");
const {
  DB_HOST,
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_TABLE,
  ELASTICSEARCH_ENDPOINT,
  ANILIST_API_ENDPOINT
} = process.env;

const q = {};
q.query = fs.readFileSync("query.graphql", "utf8");

const submitQuery = async (query, variables) => {
  query.variables = variables;
  try {
    const response = await fetch(ANILIST_API_ENDPOINT, {
      method: "POST",
      body: JSON.stringify(query),
      headers: { "Content-Type": "application/json" }
    }).then(res => res.json());
    if (response.errors) {
      console.log(response.errors);
    }
    return response.data;
  } catch (e) {
    console.log(e);
    return null;
  }
};

const getTitle = title => (title.native ? title.native : title.romaji);

const perPage = 50;
const numOfWorker = 5;

if (cluster.isMaster) {
  (async () => {
    for (let args of process.argv.slice(2)) {
      if (args === "--anime") {
        const id = process.argv[process.argv.indexOf("--anime") + 1];
        console.log(`Crawling anime ${id}`);
        const anime = (await submitQuery(q, { id })).Page.media[0];
        const worker = cluster.fork();
        worker.send({ task: "store", anime });
        worker.on("message", message => {
          console.log(`Completed anime ${anime.id} (${getTitle(anime.title)})`);
          worker.kill();
        });
      }

      if (args === "--page") {
        const value = process.argv[process.argv.indexOf("--page") + 1];
        const format = /^(\d+)(-)?(\d+)?$/;
        const startPage = parseInt(value.match(format)[1], 10);
        let lastPage = parseInt(value.match(format)[3], 10);
        if (!value.match(format)[2]) {
          lastPage = startPage;
        } else if (value.match(format)[2] && isNaN(lastPage)) {
          console.log("Looking up last page number");
          lastPage = (await submitQuery(q, {
            page: 1,
            perPage
          })).Page.pageInfo.lastPage;
        }
        console.log(`Crawling page ${startPage}-${lastPage}`);

        for (let page = startPage; page <= lastPage; page++) {
          console.log(`Crawling page ${page}`);
          const animeList = (await submitQuery(q, {
            page,
            perPage
          })).Page.media;
          console.log(`Completed page ${page}`);
          for (let i = 0; i < numOfWorker; i++) {
            const worker = cluster.fork();
            if (animeList.length === 0) {
              worker.kill();
            } else {
              worker.send({ task: "store", anime: animeList.pop() });
            }
            worker.on("message", anime => {
              console.log(
                `Completed anime ${anime.id} (${getTitle(anime.title)})`
              );
              if (animeList.length === 0) {
                worker.kill();
              } else {
                worker.send({ task: "store", anime: animeList.pop() });
              }
            });
          }
        }
        console.log(`Completed page ${startPage}-${lastPage}`);
      }
    }
  })();
} else {
  const knex = require("knex")({
    client: "mysql",
    connection: {
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME
    }
  });

  process.on("message", async msg => {
    if (msg.task === "fetch") {
    } else if (msg.task === "store") {
      // delete the record from mariadb if already exists
      await knex(DB_TABLE)
        .where({ id: msg.anime.id })
        .del();

      // store the json to mariadb
      await knex(DB_TABLE).insert({
        id: msg.anime.id,
        json: JSON.stringify(msg.anime)
      });

      // select the data back from mariadb
      // anilist_view is a json combined with anilist_chinese json
      const mergedEntry = await knex("anilist_view")
        .where({ id: msg.anime.id })
        .select("json");

      // put the json to elasticsearch
      const response = await fetch(
        `${ELASTICSEARCH_ENDPOINT}/anime/${msg.anime.id}`,
        {
          method: "PUT",
          body: mergedEntry[0].json,
          headers: { "Content-Type": "application/json" }
        }
      );
      process.send(msg.anime);
    }
  });

  process.on("exit", () => {
    knex.destroy();
  });
}

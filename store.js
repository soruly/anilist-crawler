require("dotenv").config();
const fetch = require("node-fetch");
const {
  DB_HOST,
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_TABLE,
  ELASTICSEARCH_ENDPOINT
} = process.env;

const knex = require("knex")({
  client: "mysql",
  connection: {
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME
  }
});

// 1. store the json to mariadb
// 2. select the json back (which is merged with anilist_chinese
// 3. put the merged json to elasticsearch
process.on("message", async anime => {
  if (!anime) {
    knex.destroy();
    process.exit(0);
  }

  // delete the record from mariadb if already exists
  await knex(DB_TABLE)
    .where({ id: anime.id })
    .del();

  // store the json to mariadb
  await knex(DB_TABLE).insert({
    id: anime.id,
    json: JSON.stringify(anime)
  });

  // select the data back from mariadb
  // anilist_view is a json combined with anilist_chinese json
  const mergedEntry = await knex("anilist_view")
    .where({ id: anime.id })
    .select("json");

  // put the json to elasticsearch
  const response = await fetch(`${ELASTICSEARCH_ENDPOINT}/anime/${anime.id}`, {
    method: "PUT",
    body: mergedEntry[0].json,
    headers: { "Content-Type": "application/json" }
  });

  process.send(anime);
});

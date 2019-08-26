require("dotenv").config();
const fs = require("fs");
const fetch = require("node-fetch");
const child_process = require("child_process");
const { ANILIST_API_ENDPOINT } = process.env;

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

const getDisplayTitle = title => (title.native ? title.native : title.romaji);

const perPage = 50;
const numOfStoreWorker = 5;

(async () => {
  for (let args of process.argv.slice(2)) {
    if (args === "--anime") {
      console.log(`Crawling anime ${animeID}`);
      const anime = (await submitQuery(q, { id: animeID })).Page.media[0];
      const storeWorker = child_process.fork("store.js");
      storeWorker.send(anime);
      storeWorker.on("message", message => {
        if (message) {
          console.log(message);
        } else {
          console.log(
            `Completed anime ${anime.id} (${getDisplayTitle(anime.title)})`
          );
        }
        storeWorker.send(null);
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
        for (let i = 0; i < numOfStoreWorker; i++) {
          const storeWorker = child_process.fork("store.js");

          storeWorker.send(animeList.pop() || null);
          storeWorker.on("message", anime => {
            console.log(
              `Completed anime ${anime.id} (${getDisplayTitle(anime.title)})`
            );
            storeWorker.send(animeList.pop() || null);
          });
        }
      }
      console.log(`Completed page ${startPage}-${lastPage}`);
    }
  }
})();

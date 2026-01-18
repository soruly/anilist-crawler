import path from "node:path";
import fs from "node:fs/promises";
import cluster from "node:cluster";

const OUTPUT_DIR = "anilist_anime";

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

if (cluster.isPrimary) {
  const [arg, value] = process.argv.slice(2);

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

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
    await fs.writeFile(path.join(OUTPUT_DIR, `${anime.id}.json`), JSON.stringify(anime, null, 2));

    process.send(anime);
  });
}

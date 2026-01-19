import path from "node:path";
import fs from "node:fs/promises";

const OUTPUT_DIR = "anilist_anime";

const query = await fs.readFile("query.graphql", "utf8");

const submitQuery = async (variables) => {
  for (let retry = 0; retry < 5; retry++) {
    const res = await fetch("https://graphql.anilist.co/", {
      method: "POST",
      body: JSON.stringify({ query, variables }),
      headers: { "Content-Type": "application/json" },
    });
    if (res.status === 200) {
      return (await res.json()).data;
    }
    if (res.status === 429) {
      const delay = Number(res.headers.get("retry-after")) || 1;
      console.log(`Rate limit reached, retry after ${delay} seconds`);
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    } else if (res.status >= 500) {
      console.log(`Server side HTTP ${res.status} error, retry after 5 seconds`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    } else {
      console.log(res);
      return null;
    }
  }
};

await fs.mkdir(OUTPUT_DIR, { recursive: true });

const [arg, value] = process.argv.slice(2);
if (arg === "--anime" && value) {
  console.log(`Crawling anime ${value}`);
  const anime = (await submitQuery({ id: value })).Page.media[0];
  console.log(`Saving anime ${anime.id} (${anime.title.native ?? anime.title.romaji})`);
  await fs.writeFile(path.join(OUTPUT_DIR, `${anime.id}.json`), JSON.stringify(anime, null, 2));
  console.log(`Saved anime ${anime.id} to ${path.join(OUTPUT_DIR, `${anime.id}.json`)}`);
} else if (arg === "--page" && value) {
  const format = /^(\d+)(-)?(\d+)?$/;
  const startPage = Number(value.match(format)[1]);
  const lastPage = value.match(format)[2] ? Number(value.match(format)[3]) : startPage;

  console.log(`Crawling page ${startPage} to ${lastPage || "end"}`);

  let page = startPage;
  while (!lastPage || page <= lastPage) {
    console.log(`Crawling page ${page}`);
    const data = await submitQuery({ page, perPage: 50 });
    await Promise.all(
      data.Page.media.map(async (anime) => {
        console.log(`Saving anime ${anime.id} (${anime.title.native ?? anime.title.romaji})`);
        await fs.writeFile(
          path.join(OUTPUT_DIR, `${anime.id}.json`),
          JSON.stringify(anime, null, 2),
        );
      }),
    );
    console.log(`Finished page ${page}`);
    if (!data.Page.pageInfo.hasNextPage) break;
    page++;
  }
  console.log(`Crawling complete. Files saved to ${OUTPUT_DIR}`);
} else {
  console.log("Usage: node index.ts --anime 1");
  console.log("       node index.ts --page 1");
  console.log("       node index.ts --page 1-");
  console.log("       node index.ts --page 1-2");
}

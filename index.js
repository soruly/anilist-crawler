require("dotenv").config();
const fs = require("fs");
const fetch = require("node-fetch");
const {
  ANILIST_API_ENDPOINT,
  DB_HOST,
  DB_USER,
  DB_PASS,
  DB_NAME,
  DB_TABLE,
  ELASTICSEARCH_ENDPOINT
} = process.env;

const q = {};
q.query = fs.readFileSync("query.graphql", "utf8");

const submitQuery = async (query, variables) => {
  if (variables.id) {
    console.log(`Crawling anime ${variables.id}`);
  } else if (variables.page) {
    console.log(`Crawling page ${variables.page}`);
  }
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

// 1. store the json to mariadb
// 2. select the json back (which is merged with anilist_chinese
// 3. put the merged json to elasticsearch
const storeData = async (id, data) => {
  try {
    const knex = require("knex")({
      client: "mysql",
      connection: {
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASS,
        database: DB_NAME
      }
    });

    // delete the record from mariadb if already exists
    await knex(DB_TABLE)
      .where({ id })
      .del();

    // store the json to mariadb
    await knex(DB_TABLE).insert({
      id,
      json: JSON.stringify(data)
    });

    // select the data back from mariadb
    // anilist_view is a json combined with anilist_chinese json
    const mergedEntry = await knex("anilist_view")
      .where({ id })
      .select("json");
    knex.destroy();

    // put the json to elasticsearch
    const response = await fetch(`${ELASTICSEARCH_ENDPOINT}/anime/${id}`, {
      method: "PUT",
      body: mergedEntry[0].json,
      headers: { "Content-Type": "application/json" }
    });
    if (response.ok) {
      return data;
    }
    return null;
  } catch (e) {
    console.log(e);
    return null;
  }
};

const getDisplayTitle = title => (title.native ? title.native : title.romaji);

const maxPerPage = 50;

const fetchAnime = async animeID => {
  try {
    const data = await submitQuery(q, { id: animeID });
    const anime = data.Page.media[0];
    await storeData(anime.id, anime);
    console.log(
      `Completed anime ${anime.id} (${getDisplayTitle(anime.title)})`
    );
  } catch (error) {
    console.log(error);
  }
};

const fetchPage = async pageNumber => {
  try {
    const data = await submitQuery(q, {
      page: pageNumber,
      perPage: maxPerPage
    });
    const anime_list = data.Page.media;
    await Promise.all(
      anime_list.map(anime =>
        storeData(anime.id, anime).then(() => {
          console.log(
            `Completed anime ${anime.id} (${getDisplayTitle(anime.title)})`
          );
        })
      )
    );
    console.log(`Completed page ${pageNumber}`);
  } catch (error) {
    console.log(error);
  }
};

const getLastPage = async () => {
  try {
    const data = await submitQuery(q, {
      page: 1,
      perPage: maxPerPage
    });
    return data.Page.pageInfo.lastPage;
  } catch (error) {
    console.log(error);
    return null;
  }
};

const args = process.argv.slice(2);

args.forEach((param, index) => {
  const value = args[index + 1];
  if (param === "--anime") {
    fetchAnime(parseInt(value, 10));
  }

  if (param === "--page") {
    const format = /^(\d+)(-)?(\d+)?$/;
    const startPage = parseInt(value.match(format)[1], 10);
    const fetchToEnd = value.match(format)[2] === "-";
    const endPage = fetchToEnd
      ? parseInt(value.match(format)[3], 10)
      : startPage;

    (async () => {
      console.log("Crawling page 1 to get last page number...");
      let last_page = await getLastPage();
      console.log(`The last page is ${last_page}`);
      last_page = endPage < last_page ? endPage : last_page;
      await Array.from(new Array(last_page + 1), (val, i) => i)
        .slice(startPage, last_page + 1)
        .reduce(
          (result, page) => result.then(() => fetchPage(page)),
          Promise.resolve()
        );
      console.log(`Completed page ${startPage}-${last_page}`);
    })();
  }

  /*
  if (param === '--cleanup') {
    let startPage = 1;

    getLastPage(260)
      .then(last_page => Array.from(new Array(last_page + 1), (val, index) => index)
        .slice(startPage, last_page + 1)
      )
      .then(pages =>
        pages
        .reduce((result, page) => result.then((allAnimeIDs) => fetchPage(page)
          .then(ids => allAnimeIDs.concat(ids))
        ), Promise.resolve([]))
      )
      .then(remoteAnimeIDs => {
        getAnimeIDs(0,100000).then(localIDs => {
          localIDs.forEach(id => {
            if(remoteAnimeIDs.indexOf(id) === -1){
              console.log(id, 'is not found on anilist');
            }
          });
        });
      });
  }
  */
});

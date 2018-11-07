require("dotenv").config();
const request = require("requestretry").defaults({json: true});
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
q.query = `
query ($page: Int = 1, $perPage: Int = 1, $id: Int, $type: MediaType = ANIME) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      perPage
      currentPage
      lastPage
      hasNextPage
    }
    media(id: $id, type: $type) {
      id
      idMal
      title {
        native
        romaji
        english
      }
      type
      format
      status
      description
      startDate {
        year
        month
        day
      }
      endDate {
        year
        month
        day
      }
      season
      episodes
      duration
      source
      hashtag
      trailer {
        id
        site
      }
      updatedAt
      coverImage {
        large
        medium
      }
      bannerImage
      genres
      synonyms
      averageScore
      meanScore
      popularity
      tags {
        id
        name
        description
        category
        rank
        isGeneralSpoiler
        isMediaSpoiler
        isAdult
      }
      relations {
        edges {
          node {
            id
            title {
              native
            }
          }
          relationType
        }
      }
      characters {
        edges {
          role
          node {
            id
            name {
              first
              last
              native
              alternative
            }
            image {
              large
              medium
            }
            siteUrl
          }
          voiceActors(language: JAPANESE) {
            id
            name {
              first
              last
              native
            }
            language
            image {
              large
              medium
            }
            siteUrl
          }
        }
      }
      staff {
        edges {
          role
          node {
            id
            name {
              first
              last
              native
            }
            language
            image {
              large
              medium
            }
            description
            siteUrl
          }
        }
      }
      studios {
        edges {
          isMain
          node {
            id
            name
            siteUrl
          }
        }
      }
      isAdult
      externalLinks {
        id
        url
        site
      }
      rankings {
        id
        rank
        type
        format
        year
        season
        allTime
        context
      }
      stats {
        scoreDistribution {
          score
          amount
        }
        statusDistribution {
          status
          amount
        }
      }
      siteUrl
    }
  }
}
`;
q.variables = {};

const submitQuery = (variables) => new Promise((resolve, reject) => {
  if (variables.id) {
    console.log(`Crawling anime ${variables.id}`);
  } else if (variables.page) {
    console.log(`Crawling page ${variables.page}`);
  }
  q.variables = variables;
  request({
    url: ANILIST_API_ENDPOINT,
    body: q,
    method: "POST",
    maxAttempts: 1,
    retryDelay: 5000,
    retryStrategy: request.RetryStrategies.HTTPOrNetworkError
  })
    .then((response) => {
    // console.log(response.statusCode);
      if (response.body.data !== null) {
        resolve(response.body.data);
      } else {
        reject(response.body.errors);
      }
    })
    .catch((error) => {
      console.log(error);
      reject(error);
    });
});

// 1. store the json to mariadb
// 2. select the json back (which is merged with anilist_chinese
// 3. put the merged json to elasticsearch
const storeData = (id, data) => new Promise(async (resolve, reject) => {
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
    await knex(DB_TABLE).where({id}).del();

    // store the json to mariadb
    await knex(DB_TABLE).insert({
      id,
      json: JSON.stringify(data)
    });

    // select the data back from mariadb
    // anilist_view is a json combined with anilist_chinese json
    const mergedEntry = await knex("anilist_view").where({id}).select("json");
    knex.destroy();

    // put the json to elasticsearch
    const entry = JSON.parse(mergedEntry[0].json);
    const dataPath = `${ELASTICSEARCH_ENDPOINT}/anime/${id}`;
    request({
      method: "PUT",
      url: dataPath,
      json: entry
    }, (error3, response) => {
      if (!error3 && response.statusCode < 400) {
        resolve(data);
      } else {
        console.log(error3);
        console.log(response);
        reject(Error(error3));
      }
    });
  } catch (e) {
    reject(Error(e));
  }
});

const getDisplayTitle = (title) => title.native ? title.native : title.romaji;

const maxPerPage = 50;

const fetchAnime = (animeID) => submitQuery({id: animeID})
  .then((data) => data.Page.media[0])
  .then((anime) => storeData(anime.id, anime)
    .then(() => {
      console.log(`Completed anime ${anime.id} (${getDisplayTitle(anime.title)})`);
    })
  )
  .catch((error) => {
    console.log(error);
  });

const fetchPage = (pageNumber) => submitQuery({page: pageNumber,
  perPage: maxPerPage})
  .then((data) => data.Page.media)
  .then((anime_list) => anime_list.map((anime) => storeData(anime.id, anime)
    .then(() => {
      console.log(`Completed anime ${anime.id} (${getDisplayTitle(anime.title)})`);
    })
  ))
  .then((list) => Promise.all(list))
  .catch((error) => {
    console.log(error);
  });

const getLastPage = () => submitQuery({page: 1,
  perPage: maxPerPage})
  .then((data) => data.Page.pageInfo.lastPage)
  .catch((error) => {
    console.log(error);
  });

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
    const endPage = fetchToEnd ? parseInt(value.match(format)[3], 10) : startPage;

    getLastPage()
      .then((last_page) => {
        console.log(`The last page is ${last_page}`);
        return last_page;
      })
      .then((last_page) => endPage < last_page ? endPage : last_page)
      .then((last_page) => Array.from(new Array(last_page + 1), (val, i) => i)
        .slice(startPage, last_page + 1)
      )
      .then((pages) =>
        pages
          .reduce((result, page) => result.then(() => fetchPage(page)), Promise.resolve())
      );
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


const request = require('requestretry').defaults({json: true});
const MariaClient = require('mariasql');
const {
  graphql_endpoint,
  mariadb_host,
  mariadb_user,
  mariadb_password,
  mariadb_database,
  mariadb_table,
  elasticsearch_endpoint
} = require('./config');

var c = new MariaClient({
  host: mariadb_host,
  user: mariadb_user,
  password: mariadb_password,
  db: mariadb_database,
  charset: 'utf8'
});

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
  if(variables.id){
    console.log(`Crawling anime ${variables.id}`);
  }
  else if(variables.page){
    console.log(`Crawling page ${variables.page}`);
  }
  q.variables = variables;
  request({
    url: graphql_endpoint,
    body: q,
    method: 'POST',
    maxAttempts: 5,
    retryDelay: 5000,
    retryStrategy: request.RetryStrategies.HTTPOrNetworkError
  })
  .then(function (response) {
    // console.log(response.statusCode);
    if(response.body.data !== null) {
      resolve(response.body.data);
    }
    else{
      reject(response.body.errors);
    }
  })
  .catch(function(error) {
    console.log(error);
    reject(error);
  })
});


// 1. store the json to mariadb
// 2. select the json back (which is merged with anilist_chinese
// 3. put the merged json to elasticsearch
let storeData = (id, data) => new Promise((resolve, reject) => {
  var c = new MariaClient({
    host: mariadb_host,
    user: mariadb_user,
    password: mariadb_password,
    db: mariadb_database,
    charset: 'utf8'
  });
  // store the json to mariadb
  const prep = c.prepare(`INSERT INTO ${mariadb_table} (id, json) VALUES (:id, :json) ON DUPLICATE KEY UPDATE json=:json;`);
  c.query(prep({
    id,
    json: JSON.stringify(data)
  }), (error, rows) => {
    if (!error) {
      // select the data back from mariadb
      // anilist_view is a json combined with anilist_chinese json
      c.query(`SELECT json FROM anilist_view WHERE id=:id`, {id},
        (error, rows) => {
          c.end();
          if(!error) {
            // put the json to elasticsearch
            const entry = JSON.parse(rows[0].json);
            const dataPath = `${elasticsearch_endpoint}/anime/${id}`;
            request({
              method: 'PUT',
              url: dataPath,
              json: entry
            }, (error, response, body) => {
              if (!error && response.statusCode < 400) {
                resolve(data);
              } else {
                console.log(error);
                console.log(response);
                reject(Error(error));
              }
            });
          } else {
            reject(Error(error));
          }
        });
    } else {
      reject(Error(error));
    }
  });
});

const getDisplayTitle = (title) => title.native ? title.native : title.romaji;

const maxPerPage = 50;

const fetchAnime = (animeID) => submitQuery({id: animeID})
  .then(data => data.Page.media[0])
  .then(anime => storeData(anime.id, anime)
    .then(() => {
      console.log(`Completed anime ${anime.id} (${getDisplayTitle(anime.title)})`);
    })
  )
  .catch(error => {console.log(error)});

const fetchPage = (pageNumber) => submitQuery({page: pageNumber, perPage: maxPerPage})
  .then(data => data.Page.media)
  .then(anime_list => anime_list.map(anime => storeData(anime.id, anime)
    .then(() => {console.log(`Completed anime ${anime.id} (${getDisplayTitle(anime.title)})`);})
  ))
  .then(list => Promise.all(list))
  .catch(error => {console.log(error)});

const getLastPage = () => submitQuery({page: 213, perPage: maxPerPage})
  .then(data => data.Page.pageInfo.lastPage)
  .catch(error => {console.log(error)});

const args = process.argv.slice(2);

args.forEach((param, index) => {
  const value = args[index + 1];
  if (param === '--anime') {
    fetchAnime(parseInt(value, 10));
  }
  
  if (param === '--page') {
    const format = /^(\d+)(-)?(\d+)?$/;
    const startPage = parseInt(value.match(format)[1]);
    const fetchToEnd = value.match(format)[2] === '-';
    const endPage = fetchToEnd ? parseInt(value.match(format)[3]) : startPage;

    getLastPage()
      .then(last_page => {
        console.log(`The last page is ${last_page}`);
        return last_page;
      })
      .then(last_page => (endPage < last_page ? endPage : last_page))
      .then(last_page => Array.from(new Array(last_page + 1), (val, index) => index)
        .slice(startPage, last_page + 1)
      )
      .then(pages =>
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


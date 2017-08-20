const request = require('requestretry').defaults({json: true});
const config = require('./config');

const graphQL_endpoint = 'https://graphql.anilist.co/';
const db_store = config.db_store;
const db_name = 'anilist2'; // elasticsearch index name

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
      youtubeId
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
        scoreDistribution
        userDistribution
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
    url: graphQL_endpoint,
    body: q,
    method: 'POST',
    maxAttempts: 5,
    retryDelay: 5000,
    retryStrategy: request.RetryStrategies.HTTPOrNetworkError
  })
  .then(function (response) {
    // console.log(response.statusCode);
    resolve(response.body.data);
  })
  .catch(function(error) {
    console.log(error);
    reject(error);
  })
});

let storeData = (id, data) => new Promise((resolve, reject) => {
  // console.log(`Storing ${type} ${data.id}`);
  let dataPath = `${db_store}${db_name}/anime/${id}`;
  request({
    method: 'PUT',
    url: dataPath,
    json: data
  }, (error, response, body) => {
    if (!error && response.statusCode < 400) {
      resolve(data);
      // console.log(`Stored ${type} ${data.id}`);
    } else {
      console.log(error);
      console.log(response);
      reject(Error(error));
    }
  });
});

const maxPerPage = 50;

const fetchAnime = (animeID) => submitQuery({id: animeID})
  .then(data => data.Page.media[0])
  .then(anime => storeData(anime.id, anime)
    .then(() => {console.log(`Completed anime ${anime.id} (${anime.title.native})`);})
  )
  .catch(error => {console.log(error)});

const fetchPage = (pageNumber) => submitQuery({page: pageNumber, perPage: maxPerPage})
  .then(data => data.Page.media)
  .then(anime_list => anime_list.map(anime => storeData(anime.id, anime)
    .then(() => {console.log(`Completed anime ${anime.id} (${anime.title.native})`);})
  ))
  .then(list => Promise.all(list))
  .catch(error => {console.log(error)});

const getLastPage = () => submitQuery({page: 1, perPage: maxPerPage})
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


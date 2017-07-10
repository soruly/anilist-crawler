'use strict';

let request = require('requestretry');
let config = require('./config');

const api_prefix = config.api_prefix;
const db_store = config.db_store;
const db_name = config.db_name; // elasticsearch index name
const user_agent = config.user_agent;
const client_id = config.client_id;
const client_secret = config.client_secret;

let access_token = '';
let access_token_expire = 0;

let getAccessToken = () => new Promise((resolve, reject) => {
  if (access_token && access_token_expire - Math.floor(new Date().getTime() / 1000) > 300) {
    resolve(access_token);
  } else {
    console.log(`Renewing access_token`);
    request({
      method: 'POST',
      url: `${api_prefix}auth/access_token`,
      json: true,
      form: {
        grant_type: 'client_credentials',
        client_id: client_id,
        client_secret: client_secret
      }
    }, (error, response, body) => {
      if (!error && response.statusCode === 200) {
        access_token = body.access_token;
        access_token_expire = body.expires;
        let expireDateTime = new Date(access_token_expire * 1000).toISOString();
        console.log(`Renewed access_token ${access_token} (valid until ${expireDateTime})`);
        resolve(access_token);
      } else {
        reject(Error(error));
      }
    });
  }
});

let fetchData = (type, id) => new Promise((resolve, reject) => {
  // console.log(`Fetching ${type} ${id}`);
  getAccessToken().then(access_token => {
    request({
      method: 'GET',
      url: `${api_prefix}${type}/${id}/page?access_token=${access_token}`,
      json: true,
      maxAttempts: 5,
      retryDelay: 5000,
      retryStrategy: request.RetryStrategies.HTTPOrNetworkError
    }, (error, response, data) => {
      if (!error && response.statusCode === 200) {
        resolve(data);
        // console.log(`Fetched ${type} ${id}`);
      } else {
        console.log(error);
        console.log(response);
        reject(Error(error));
      }
    });
  });
});

let storeData = (data, index, type, id) => new Promise((resolve, reject) => {
  // console.log(`Storing ${type} ${data.id}`);
  let dataPath = `${db_store}${index}/${type}/${id}`;
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

let fetchAnime = id => new Promise((resolve, reject) => {
  console.log(`Crawling anime ${id}`);
  fetchData('anime', id)
    .then(anime =>
      Promise.all([
        storeData(anime, db_name, 'anime', anime.id),

        Promise.all(
          anime.characters.map(character => character.id)
          .filter((elem, index, self) => index === self.indexOf(elem))
          .map(id => fetchData('character', id)
            .then(character => storeData(character, db_name, 'character', character.id))
          )
        ),

        Promise.all(
          anime.staff.map(staff => staff.id).concat(
            anime.characters
            .filter(character => character.actor[0])
            .map(character => character.actor[0].id)
          )
          .filter((elem, index, self) => index === self.indexOf(elem))
          .map(id => fetchData('staff', id)
            .then(staff => storeData(staff, db_name, 'staff', staff.id))
          )
        )
      ])
    )
    .then((anime) => {
      console.log(`Completed anime ${id} (${anime[0].title_japanese})`);
      resolve();
    });
});

let fetchPage = (start, end) => new Promise((resolve, reject) => {
  console.log(`Fetching page ${start}`);
  getAccessToken().then(access_token => {
    request({
      method: 'GET',
      url: `${api_prefix}browse/anime?sort=id&page=${start}&access_token=${access_token}`,
      json: true
    }, (error, response, data) => {
      console.log(`Fetched page ${start}`);
      resolve(data.map(anime => anime.id));
    });
  });
});

let getLastPage = (last_page) => new Promise((resolve, reject) => {
  fetchPage(last_page).then(ids => {
    if (ids.length < 40) {
      console.log(`The last page is ${last_page}`);
      resolve(last_page);
    } else {
      resolve(getLastPage(last_page + 1));
    }
  });
});

let getAnimeIDs = (from, size) => {
  return new Promise((resolve, reject) => {
    let animeList = [];
    request({
      method: 'POST',
      url: `${db_store}anilist/anime/_search`,
      json: {
        "from": from,
        "size": size,
        "stored_fields": ["id"],
        "query": {
          "match_all": {}
        },
        "sort": [{
          "id": {
            "order": "asc"
          }
        }]
      }
    }, function(error, res) {
      if (!error && res.statusCode < 400) {
        res.body.hits.hits.forEach((anime) => {
          animeList.push(anime.sort[0]);
        });
        resolve(animeList);
      } else {
        console.error(res.body);
      }
    });
  });
};

let args = process.argv.slice(2);

args.forEach((param, index) => {
  let value = args[index + 1];
  if (param === '--anime') {
    let animeID = parseInt(value, 10);
    fetchAnime(animeID);
  }
  if (param === '--page') {
    let format = /^(\d+)(-)?(\d+)?$/;
    let startPage = parseInt(value.match(format)[1]);
    let fetchToEnd = value.match(format)[2] === '-';
    let endPage = fetchToEnd ? parseInt(value.match(format)[3]) : startPage;

    getLastPage(256)
      .then(last_page => (endPage < last_page ? endPage : last_page))
      .then(last_page => Array.from(new Array(last_page + 1), (val, index) => index)
        .slice(startPage, last_page + 1)
      )
      .then(pages =>
        pages
        .reduce((result, page) => result.then(() => fetchPage(page)
          .then(ids =>
            ids.reduce((result, id) => result.then(() => fetchAnime(id)), Promise.resolve())
          )
        ), Promise.resolve())
      );
  }
  if (param === '--cleanup') {
    let startPage = 1;

    getLastPage(256)
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
});

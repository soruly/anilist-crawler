"use strict";

let request = require('requestretry');
let config = require('./config');

const api_prefix = config.api_prefix;
const db_store = config.db_store;
const db_name = config.db_name; //elasticsearch index name
const user_agent = config.user_agent;
const client_id = config.client_id;
const client_secret = config.client_secret;

let access_token = '';
let access_token_expire = 0;

let getAccessToken = () => new Promise(function(resolve, reject) {
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
    }, function(error, response, body) {
      if (!error && response.statusCode == 200) {
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

let fetchData = (type, id) => new Promise(function(resolve, reject) {
  //console.log(`Fetching ${type} ${id}`);
  getAccessToken().then(access_token => {
    request({
      method: 'GET',
      url: `${api_prefix}${type}/${id}/page?access_token=${access_token}`,
      json: true,
      maxAttempts: 5,
      retryDelay: 5000,
      retryStrategy: request.RetryStrategies.HTTPOrNetworkError
    }, function(error, response, data) {
      if (!error && response.statusCode == 200) {
        resolve(data);
        //console.log(`Fetched ${type} ${id}`);
      } else {
        console.log(error);
        console.log(response);
        reject(Error(error));
      }
    })
  });
});

let storeData = (data, index, type, id) => new Promise(function(resolve, reject) {
  //console.log(`Storing ${type} ${data.id}`);
  let dataPath = `${db_store}${index}/${type}/${id}`;
  request({
    method: 'PUT',
    url: dataPath,
    json: data
  }, function(error, response, body) {
    if (!error && response.statusCode < 400) {
      resolve(data);
      //console.log(`Stored ${type} ${data.id}`);
    } else {
      console.log(error);
      console.log(response);
      reject(Error(error));
    }
  });
});

let fetchAnime = id => new Promise(function(resolve, reject) {
  console.log(`Crawling anime ${id}`);
  fetchData('anime', id)
    .then(anime =>
      Promise.all([
        storeData(anime, db_name, 'anime', anime.id),

        Promise.all(
          anime.characters.map(character => character.id)
          .filter((elem, index, self) => index == self.indexOf(elem))
          .map(id => fetchData('character', id)
            .then(character => storeData(character, db_name, 'character', character.id))
          )
        ),

        Promise.all(
          anime.staff.map(staff => staff.id).concat(anime.characters.filter(character => character.actor[0]).map(character => character.actor[0].id))
          .filter((elem, index, self) => index == self.indexOf(elem))
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

let fetchPage = (start, end) => new Promise(function(resolve, reject) {
  console.log(`Fetching page ${start}`);
  getAccessToken().then(access_token => {
    request({
      method: 'GET',
      url: `${api_prefix}browse/anime?sort=id&page=${start}&access_token=${access_token}`,
      json: true,
    }, function(error, response, data) {
      console.log(`Fetched page ${start}`);
      resolve(data.map(anime => anime.id));
    });
  });
});

let getLastPage = (last_page) => new Promise(function(resolve, reject) {
  fetchPage(last_page).then(ids => {
    if (ids.length < 40) {
      console.log(`The last page is ${last_page}`);
      resolve(last_page);
    } else {
      resolve(getLastPage(last_page + 1));
    }
  });
});

let args = process.argv.slice(2);

args.forEach((value, index) => {
  if (value === '--anime') {
    fetchAnime(args[index + 1]);
  }
  if (value === '--page') {
    fetchPage(args[index + 1]).then(ids =>
      ids.reduce((result, id) => result.then(() => fetchAnime(id)), Promise.resolve())
    );
  }
  if (value === '--all') {
    getLastPage(249)
      .then(last_page => Array.from(new Array(last_page), (val, index) => index + 1))
      .then(pages => 
        pages.reduce((result, page) => result.then(() => fetchPage(page)
          .then(ids =>
            ids.reduce((result, id) => result.then(() => fetchAnime(id)), Promise.resolve())
          )
        ), Promise.resolve())
      );
  }
});

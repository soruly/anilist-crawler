"use strict";

let Crawler = require('crawler');
let request = require('request');
let config = require('./config');

var access_token = '';

const api_prefix = 'https://anilist.co/api/';
const db_store = 'http://127.0.0.1:9200/';

let crawler = new Crawler({
  maxConnections: 10,
  timeout: 5000,
  retries: 3,
  retryTimeout: 5000,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Safari/537.36',
  onDrain: () => {
    console.log("No more jobs on queue, exit");
    process.exit();
  },
  callback: (error, result) => {
    console.error(error);
    console.log(result);
  }
});

let getAccessToken = (callback) => {
  request({
    method: 'POST',
    url: `${api_prefix}auth/access_token`,
    json: true,
    form: {
      grant_type: "client_credentials",
      client_id: config.client_id,
      client_secret: config.client_secret
    }
  }, function(error, res, body) {
    if (!error && res.statusCode == 200 && res.body.access_token) {
      access_token = res.body.access_token;
      console.log(access_token);
      if (callback) {
        callback();
      }
      setTimeout(getAccessToken, (res.body.expires_in - 300) * 1000);
    } else {
      console.log('login failed');
    }
  });
};

getAccessToken(() => {
  browse(240, 10);
});

let staffList = [];
let characterList = [];
let animeList = [];

let browse = (startPage, numOfPage) => {
  for (let page = startPage; page <= startPage + numOfPage; page++) {
    crawler.queue({
      uri: `${api_prefix}browse/anime?sort=id&page=${page}&access_token=${access_token}`,
      priority: 1,
      jQuery: false,
      callback: function(error, result) {
        console.log(`Page ${page} finished`);
        let res = JSON.parse(result.body);
        res.forEach((anime) => {
          if (animeList.indexOf(anime.id) === -1) {
            animeList.push(anime.id);
          }
        });
        if (page === startPage + numOfPage && res.length >= 40) {
          browse(page + 1, numOfPage);
        }
        if (crawler.queueItemSize <= 1) {
          animeList.forEach((id) => {
            fetchAnime(id);
          });
        }
      }
    });
  }
};


let fetchAnime = (id) => {
  crawler.queue({
    uri: `${api_prefix}anime/${id}/page?access_token=${access_token}`,
    priority: 2,
    jQuery: false,
    callback: function(error, result) {
      let anime = JSON.parse(result.body);
      storeData(anime, 'anilist', 'anime', anime.id);
      console.log(`Anime ${id} (${anime.title_japanese}) finished`);
      if (anime.staff) {
        anime.staff.forEach((staff) => {
          if (staffList.indexOf(staff.id) === -1) {
            staffList.push(staff.id);
          }
        })
      }
      if (anime.characters) {
        anime.characters.forEach((character) => {
          if (characterList.indexOf(character.id) === -1) {
            characterList.push(character.id);
          }
        })
      }
      if (crawler.queueItemSize <= 1) {
        staffList.forEach((id) => {
          fetchStaff(id);
        });
        characterList.forEach((id) => {
          fetchCharacter(id);
        });
      }
    }
  });
};

let fetchStaff = (id) => {
  crawler.queue({
    uri: `${api_prefix}staff/${id}?access_token=${access_token}`,
    jQuery: false,
    callback: function(error, result) {
      let staff = JSON.parse(result.body);
      storeData(staff, 'anilist', 'staff', staff.id);
      console.log(`Staff ${id} (${staff.name_first_japanese}${staff.name_last_japanese}) finished`);
    }
  });
};

let fetchCharacter = (id) => {
  crawler.queue({
    uri: `${api_prefix}character/${id}?access_token=${access_token}`,
    jQuery: false,
    callback: function(error, result) {
      let character = JSON.parse(result.body);
      storeData(character, 'anilist', 'character', character.id);
      console.log(`Character ${id} (${character.name_japanese}) finished`);
    }
  });
};

let storeData = (data, index, type, id) => {
  let dataPath = `${db_store}${index}/${type}/${id}`;
  request({
    method: 'PUT',
    url: dataPath,
    json: data
  }, function(error, response, newdata) {
    if (response.statusCode < 400) {
      console.log(`Stored anime ${data.id} (${data.title_japanese})`);
    } else {
      console.error(error, response, data);
    }
  });

};

"use strict";

let Crawler = require('crawler');
let request = require('request');
let fetch = require('node-fetch');
let FormData = require('form-data');
let config = require('./config');
let loginForm = new FormData();
loginForm.append('grant_type', 'client_credentials');
loginForm.append('client_id', config.client_id);
loginForm.append('client_secret', config.client_secret);

const api_prefix = 'https://anilist.co/api/';
let access_token = '';

let crawler = new Crawler({
  maxConnections: 10,
  timeout: 5000,
  retries: 3,
  retryTimeout: 5000,
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Safari/537.36',
  onDrain: () => {
    console.log("Not more jobs on queue, exit");
    process.exit();
  },
  callback: (error, result) => {
    console.error(error);
    console.log(result);
  }
});

let getAccessToken = fetch(`${api_prefix}auth/access_token`, {
  method: 'POST',
  body: loginForm
}).then((response) => {
  return response.json();
}).then((res) => {
  access_token = res.access_token;
});



let staffList = [];
let characterList = [];

let browse = (startPage, numOfPage) => {
  let animeList = [];
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
          animeList.sort();
          animeList.forEach((id) => {
            fetchAnime(id);
          });
        }
      }
    });
  }
}


let fetchAnime = (id) => {
  crawler.queue({
    uri: `${api_prefix}anime/${id}/page?access_token=${access_token}`,
    priority: 2,
    jQuery: false,
    callback: function(error, result) {
      let anime = JSON.parse(result.body);
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
        staffList.sort;
        staffList.forEach((id) => {
          fetchStaff(id);
        });
        characterList.sort();
        characterList.forEach((id) => {
          fetchCharacter(id);
        });
      }
    }
  });
}

let fetchStaff = (id) => {
  crawler.queue({
    uri: `${api_prefix}staff/${id}?access_token=${access_token}`,
    jQuery: false,
    callback: function(error, result) {
      let staff = JSON.parse(result.body);
      console.log(`Staff ${id} (${staff.name_first_japanese}${staff.name_last_japanese}) finished`);
    }
  });
}

let fetchCharacter = (id) => {
  crawler.queue({
    uri: `${api_prefix}character/${id}?access_token=${access_token}`,
    jQuery: false,
    callback: function(error, result) {
      let character = JSON.parse(result.body);
      console.log(`Character ${id} (${character.name_japanese}) finished`);
    }
  });
}

getAccessToken.then(() => {
  browse(240, 10);
});

setInterval(() => {
  console.log(`${crawler.queueItemSize} jobs remaining`);
}, 1000);
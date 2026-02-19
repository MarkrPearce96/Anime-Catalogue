'use strict';

const MEDIA_FIELDS = `
  id
  title {
    romaji
    english
    native
  }
  coverImage {
    extraLarge
    large
  }
  bannerImage
  description(asHtml: false)
  genres
  format
  status
  episodes
  duration
  season
  seasonYear
  averageScore
  popularity
  studios(isMain: true) {
    nodes {
      name
      siteUrl
    }
  }
  trailer {
    id
    site
  }
  siteUrl
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
`;

const TRENDING_QUERY = `
  query TrendingAnime($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
        total
      }
      media(type: ANIME, isAdult: false, sort: TRENDING_DESC) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const SEASON_QUERY = `
  query SeasonAnime($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
        total
      }
      media(type: ANIME, isAdult: false, sort: POPULARITY_DESC, season: $season, seasonYear: $seasonYear) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const POPULAR_QUERY = `
  query PopularAnime($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
        total
      }
      media(type: ANIME, isAdult: false, sort: POPULARITY_DESC) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const TOP_QUERY = `
  query TopAnime($page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
        total
      }
      media(type: ANIME, isAdult: false, sort: SCORE_DESC) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const ANIME_DISCOVER_QUERY = `
  query AnimeDiscover($page: Int, $perPage: Int, $genre: String, $format: MediaFormat, $status: MediaStatus, $year: Int) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        hasNextPage
        total
      }
      media(type: ANIME, isAdult: false, sort: POPULARITY_DESC, genre: $genre, format: $format, status: $status, seasonYear: $year) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const MEDIA_BY_ID_QUERY = `
  query MediaById($id: Int) {
    Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS}
    }
  }
`;

module.exports = {
  TRENDING_QUERY,
  SEASON_QUERY,
  POPULAR_QUERY,
  TOP_QUERY,
  ANIME_DISCOVER_QUERY,
  MEDIA_BY_ID_QUERY
};

'use strict';

// Year options for the anime discover filter (current year → 2000)
const currentYear = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: currentYear - 1994 }, (_, i) => String(currentYear - i));

const manifest = {
  id: 'com.animecatalogue.stremio',
  version: '1.0.0',
  name: 'Anime Catalogue',
  description: 'Trending, seasonal, and popular anime from AniList.',
  resources: ['catalog', 'meta'],
  types: ['series', 'movie', 'anime'],
  idPrefixes: ['kitsu:', 'anilist:'],
  catalogs: [
    {
      type: 'series',
      id: 'anilist-trending',
      name: 'Trending Now',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'anilist-season',
      name: 'Popular This Season',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'anilist-popular',
      name: 'Most Popular',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'anilist-top',
      name: 'Top 100 Anime',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'anilist-recently-updated',
      name: 'Recently Updated',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'anime',
      id: 'anilist-anime',
      name: 'Anime',
      extra: [
        {
          name: 'genre',
          isRequired: true,
          options: [
            'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror',
            'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological',
            'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'
          ]
        },
        {
          name: 'format',
          isRequired: false,
          options: ['TV', 'Movie', 'OVA', 'ONA', 'Special']
        },
        {
          name: 'status',
          isRequired: false,
          options: ['Airing', 'Finished', 'Upcoming']
        },
        {
          name: 'year',
          isRequired: false,
          options: YEAR_OPTIONS
        },
        { name: 'skip', isRequired: false }
      ]
    },
    {
      type: 'series',
      id: 'anilist-search',
      name: 'Anime Catalogue',
      extra: [
        { name: 'search', isRequired: true },
        { name: 'skip', isRequired: false }
      ]
    }
  ]
};

module.exports = manifest;

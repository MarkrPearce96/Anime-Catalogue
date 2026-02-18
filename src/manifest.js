'use strict';

const manifest = {
  id: 'com.animecatalogue.stremio',
  version: '1.0.0',
  name: 'Anime Catalogue',
  description: 'Trending, seasonal, and popular anime from AniList.',
  resources: ['catalog', 'meta'],
  types: ['series', 'movie'],
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
      id: 'anilist-az',
      name: 'A-Z',
      extra: [{ name: 'skip', isRequired: false }]
    },
    {
      type: 'series',
      id: 'anilist-discover',
      name: 'Anime',
      extra: [
        {
          name: 'genre',
          isRequired: false,
          options: [
            'Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Horror',
            'Mahou Shoujo', 'Mecha', 'Music', 'Mystery', 'Psychological',
            'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural', 'Thriller'
          ]
        },
        { name: 'skip', isRequired: false }
      ]
    }
  ]
};

module.exports = manifest;

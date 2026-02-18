'use strict';

/**
 * Maps current month to AniList season enum + year.
 * @returns {{ season: string, year: number }}
 */
function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = now.getFullYear();

  let season;
  if (month >= 1 && month <= 3) season = 'WINTER';
  else if (month >= 4 && month <= 6) season = 'SPRING';
  else if (month >= 7 && month <= 9) season = 'SUMMER';
  else season = 'FALL';

  return { season, year };
}

/**
 * Map AniList format to Stremio type.
 * @param {string} format
 * @returns {'movie'|'series'}
 */
function anilistFormatToStremioType(format) {
  if (format === 'MOVIE' || format === 'MUSIC') return 'movie';
  return 'series';
}

/**
 * Strip HTML tags from a string.
 * @param {string} str
 * @returns {string}
 */
function stripHtml(str) {
  if (!str) return '';
  return str
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

/**
 * Get the preferred display title from AniList title object.
 * @param {{ english?: string, romaji?: string, native?: string }} title
 * @returns {string}
 */
function getTitle(title) {
  return title.english || title.romaji || title.native || 'Unknown';
}

/**
 * Build a catalog meta preview item.
 * @param {object} media  - AniList media object
 * @param {string} stremioId - resolved stremio ID (e.g. "kitsu:12345")
 * @returns {object}
 */
function buildMetaPreview(media, stremioId) {
  const type = anilistFormatToStremioType(media.format);
  const name = getTitle(media.title);

  const meta = {
    id: stremioId,
    type,
    name,
    poster: (media.coverImage && (media.coverImage.extraLarge || media.coverImage.large)) || undefined,
    background: media.bannerImage || undefined,
    genres: media.genres || [],
    description: stripHtml(media.description)
  };

  if (media.averageScore) {
    meta.imdbRating = (media.averageScore / 10).toFixed(1);
  }

  if (media.startDate && media.startDate.year) {
    meta.releaseInfo = String(media.startDate.year);
    if (media.endDate && media.endDate.year && media.endDate.year !== media.startDate.year) {
      meta.releaseInfo += `-${media.endDate.year}`;
    }
  }

  return meta;
}

/**
 * Build a full meta object (for meta handler responses).
 * @param {object} media
 * @param {string} stremioId
 * @returns {object}
 */
function buildFullMeta(media, stremioId) {
  const meta = buildMetaPreview(media, stremioId);

  // Runtime (minutes per episode)
  if (media.duration) {
    meta.runtime = `${media.duration} min`;
  }

  // Episode count
  if (media.episodes) {
    meta.episodeCount = media.episodes;
  }

  // Trailers (YouTube only)
  if (media.trailer && media.trailer.site === 'youtube' && media.trailer.id) {
    meta.trailers = [{
      source: media.trailer.id,
      type: 'Trailer'
    }];
  }

  // Links
  meta.links = [];

  if (media.siteUrl) {
    meta.links.push({
      name: 'AniList',
      category: 'Sites',
      url: media.siteUrl
    });
  }

  const studio = media.studios && media.studios.nodes && media.studios.nodes[0];
  if (studio) {
    meta.links.push({
      name: studio.name,
      category: 'Studios',
      url: studio.siteUrl || undefined
    });
  }

  // Status
  if (media.status) {
    const statusMap = {
      FINISHED: 'Ended',
      RELEASING: 'Continuing',
      NOT_YET_RELEASED: 'Upcoming',
      CANCELLED: 'Cancelled',
      HIATUS: 'On Hiatus'
    };
    meta.status = statusMap[media.status] || media.status;
  }

  return meta;
}

/**
 * Convert Kitsu episode objects into a Stremio videos array.
 *
 * @param {Array}  kitsuEpisodes - raw objects from fetchKitsuEpisodes()
 * @param {string} stremioId     - e.g. "kitsu:47759"
 * @returns {Array}
 */
function buildVideosFromKitsuEpisodes(kitsuEpisodes, stremioId) {
  if (!kitsuEpisodes || kitsuEpisodes.length === 0) return [];

  return kitsuEpisodes
    .filter(ep => ep.number != null)
    .map(ep => {
      const epNum   = ep.number;
      const season  = ep.seasonNumber || 1;
      const title   = ep.canonicalTitle || ep.titles && (ep.titles.en_jp || ep.titles.en) || `Episode ${epNum}`;
      const thumb   = ep.thumbnail && ep.thumbnail.original;
      const airdate = ep.airdate ? new Date(ep.airdate).toISOString() : undefined;

      const video = {
        id:       `${stremioId}:${season}:${epNum}`,
        title,
        season,
        episode:  epNum,
        released: airdate
      };

      if (thumb) video.thumbnail = thumb;
      if (ep.description) video.overview = ep.description;

      return video;
    });
}

module.exports = {
  getCurrentSeason,
  anilistFormatToStremioType,
  buildMetaPreview,
  buildFullMeta,
  buildVideosFromKitsuEpisodes,
  getTitle,
  stripHtml
};

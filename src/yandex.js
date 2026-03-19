/**
 * Yandex Games SDK wrapper.
 *
 * Provides a unified API regardless of whether the Yandex SDK is available
 * (falls back gracefully to localStorage for development/testing).
 */

let ysdk   = null;
let player = null;

const LS_KEY = 'diamond-painting-save';

export async function initYandex() {
  try {
    if (typeof YaGames === 'undefined') {
      console.info('[Yandex] SDK not available – using localStorage fallback.');
      return false;
    }
    ysdk   = await YaGames.init();
    player = await ysdk.getPlayer({ scopes: false });
    ysdk.features.LoadingAPI?.ready();
    console.info('[Yandex] SDK initialized.');
    return true;
  } catch (err) {
    console.warn('[Yandex] SDK init failed:', err);
    return false;
  }
}

// ─── Cloud Save / Load ────────────────────────────────────────────────────────

/**
 * Load saved game data (cloud or localStorage fallback).
 * @returns {Promise<object>}
 */
export async function loadData() {
  try {
    if (player) {
      const data = await player.getData(['save']);
      return data.save ?? defaultSave();
    }
  } catch (e) {
    console.warn('[Yandex] loadData failed:', e);
  }
  // localStorage fallback
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : defaultSave();
  } catch (_) {
    return defaultSave();
  }
}

/**
 * Persist game data (cloud + localStorage).
 * @param {object} data
 */
export async function saveData(data) {
  // Always write localStorage for offline resilience
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (_) {}

  if (player) {
    try {
      await player.setData({ save: data });
    } catch (e) {
      console.warn('[Yandex] setData failed:', e);
    }
  }
}

function defaultSave() {
  return {
    completedLevels: [],
    scores:  {},      // levelId → score
    progress: {},     // levelId → { filledCells: number[] }
  };
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

/**
 * Submit a score to the leaderboard.
 * @param {number} score
 */
export async function submitScore(score) {
  if (!ysdk) return;
  try {
    await ysdk.leaderboards.setLeaderboardScore('main', score);
  } catch (e) {
    console.warn('[Yandex] submitScore failed:', e);
  }
}

/**
 * Open the leaderboard popup.
 */
export async function showLeaderboard() {
  if (!ysdk) {
    alert('Leaderboard is only available in the Yandex Games environment.');
    return;
  }
  try {
    ysdk.leaderboards.getLeaderboardPlayerEntry('main').catch(() => {});
  } catch (e) {
    console.warn('[Yandex] showLeaderboard failed:', e);
  }
}

// ─── Ads ──────────────────────────────────────────────────────────────────────

/**
 * Show an interstitial ad (between levels).
 * @returns {Promise<void>}
 */
export async function showInterstitial() {
  if (!ysdk) return;
  return new Promise(resolve => {
    ysdk.adv.showFullscreenAdv({
      callbacks: {
        onClose:  resolve,
        onError:  resolve,
        onOffline: resolve,
      },
    });
  });
}

/**
 * Show a rewarded ad (for bucket-fill hint).
 * @returns {Promise<boolean>} true if the user watched it fully
 */
export async function showRewardedAd() {
  if (!ysdk) return false;
  return new Promise(resolve => {
    ysdk.adv.showRewardedVideo({
      callbacks: {
        onRewarded: () => resolve(true),
        onClose:    () => resolve(false),
        onError:    () => resolve(false),
      },
    });
  });
}

// ─── Localisation ─────────────────────────────────────────────────────────────

// ─── Gameplay API ─────────────────────────────────────────────────────────────

/**
 * Signal to Yandex that active gameplay has started.
 * Helps Yandex optimize interstitial ad delivery.
 */
export function gameplayStart() {
  try { ysdk?.features.GameplayAPI?.start(); } catch (_) {}
}

/**
 * Signal to Yandex that active gameplay has stopped (menu, complete screen, ad).
 */
export function gameplayStop() {
  try { ysdk?.features.GameplayAPI?.stop(); } catch (_) {}
}

// ─── Localisation ─────────────────────────────────────────────────────────────

/**
 * Get the player's preferred language code (e.g. "en", "ru", "tr").
 * @returns {string}
 */
export function getLang() {
  try {
    if (ysdk) return ysdk.environment.i18n.lang;
  } catch (_) {}
  return navigator.language?.slice(0, 2) ?? 'en';
}

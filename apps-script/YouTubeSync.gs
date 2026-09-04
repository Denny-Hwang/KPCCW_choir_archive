/**
 * 중앙아트TV 채널 미러링 + 매칭 (§9.4).
 *
 * 곡마다 검색하지 않는다. search.list가 호출당 100 units인 반면 playlistItems.list는
 * 50개당 1 unit이라, 채널 전체를 훑어도 수십 units에 그친다.
 *
 * 이 구조의 핵심은 비용이 아니라 재실행 가능성이다. 영상 제목 형식은 실제 데이터를
 * 받아보기 전에는 확정할 수 없는데, 캐시가 시트에 있으면 매칭 규칙만 고쳐
 * 할당량을 다시 태우지 않고 몇 번이든 돌릴 수 있다.
 *
 * API 키는 스크립트 속성에 둔다 (파일 > 프로젝트 속성 > 스크립트 속성, 키 이름 YOUTUBE_API_KEY).
 * 서버측이라 프론트엔드에 노출되지 않는다 (§13.3).
 */

var YT_API = 'https://www.googleapis.com/youtube/v3';

function getApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('YOUTUBE_API_KEY');
  if (!key) {
    throw new Error('스크립트 속성에 YOUTUBE_API_KEY가 없습니다. 프로젝트 설정 > 스크립트 속성에서 추가하세요.');
  }
  return key;
}

function ytGet_(path, params) {
  params.key = getApiKey_();
  var query = Object.keys(params)
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
    .join('&');
  var response = UrlFetchApp.fetch(YT_API + path + '?' + query, { muteHttpExceptions: true });
  var body = response.getContentText();
  if (response.getResponseCode() !== 200) {
    throw new Error('YouTube API 오류 ' + response.getResponseCode() + ': ' + body.slice(0, 300));
  }
  return JSON.parse(body);
}

/** [1단계] 채널 미러링. yt_cache에 videoId 기준으로 upsert 한다. */
function syncChannel() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var handle = readConfigValue_(ss, '유튜브채널핸들') || 'JandAArt';

  try {
    var channel = ytGet_('/channels', { part: 'id,snippet', forHandle: handle });
    if (!channel.items || !channel.items.length) {
      ui.alert('채널을 찾지 못했습니다: @' + handle);
      return;
    }
    var channelId = channel.items[0].id;

    var playlists = [];
    var pageToken = '';
    do {
      var page = ytGet_('/playlists', {
        part: 'id,snippet', channelId: channelId, maxResults: 50, pageToken: pageToken
      });
      playlists = playlists.concat(page.items || []);
      pageToken = page.nextPageToken || '';
    } while (pageToken);

    var rows = [];
    var now = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm');

    for (var p = 0; p < playlists.length; p++) {
      var playlist = playlists[p];
      var itemToken = '';
      do {
        var items = ytGet_('/playlistItems', {
          part: 'snippet', playlistId: playlist.id, maxResults: 50, pageToken: itemToken
        });
        (items.items || []).forEach(function (item) {
          var snippet = item.snippet || {};
          var resource = snippet.resourceId || {};
          if (!resource.videoId) return;
          rows.push([
            resource.videoId,
            snippet.title || '',
            playlist.snippet.title || '',
            playlist.id,
            snippet.position != null ? snippet.position + 1 : '',
            snippet.publishedAt ? String(snippet.publishedAt).slice(0, 10) : '',
            now
          ]);
        });
        itemToken = items.nextPageToken || '';
      } while (itemToken);
    }

    var added = upsertCache_(ss, rows);
    ui.alert(
      '채널 동기화 완료',
      '재생목록 ' + playlists.length + '개 · 영상 ' + rows.length + '개\n' +
        '새로 추가 ' + added + '개 (나머지는 갱신)\n\n' +
        'yt_cache 시트를 열어 영상 제목 형식을 눈으로 확인한 뒤, 필요하면 ' +
        'YouTubeSync.gs의 parseVideoTitle_ 규칙을 고치고 "영상 매칭"을 다시 실행하세요. ' +
        '재매칭은 API 할당량을 쓰지 않습니다.',
      ui.ButtonSet.OK
    );
  } catch (err) {
    ui.alert('동기화 실패', String(err.message || err), ui.ButtonSet.OK);
  }
}

function upsertCache_(ss, rows) {
  var sheet = ss.getSheetByName('yt_cache');
  if (!sheet) throw new Error('yt_cache 시트가 없습니다. 먼저 "시트 초기 생성"을 실행하세요.');

  var existing = {};
  if (sheet.getLastRow() > 1) {
    var current = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
    for (var i = 0; i < current.length; i++) existing[String(current[i][0])] = i + 2;
  }

  var appended = [];
  for (var r = 0; r < rows.length; r++) {
    var videoId = String(rows[r][0]);
    if (existing[videoId]) {
      sheet.getRange(existing[videoId], 1, 1, 7).setValues([rows[r]]);
    } else {
      appended.push(rows[r]);
      existing[videoId] = -1; // 같은 실행 안에서의 중복을 막는다.
    }
  }
  if (appended.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, 7).setValues(appended);
  }
  return appended.length;
}

/**
 * [2단계] 매칭. yt_cache를 읽어 practice_links에 append 한다.
 *
 * 자동 수집한 데이터는 초안이지 사실이 아니다 (§원칙). 전부 검증=FALSE로 들어가고,
 * 기존 행은 절대 덮어쓰지 않는다 (§9.3 append only).
 */
function matchVideos() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();

  var cache = readSheet_(ss, 'yt_cache', tz);
  if (!cache.length) {
    ui.alert('yt_cache가 비어 있습니다. 먼저 "채널 동기화"를 실행하세요.');
    return;
  }

  var songs = readSheet_(ss, 'songs', tz);
  var byCode = {};
  var byBookAndTitle = {};
  for (var s = 0; s < songs.length; s++) {
    var song = songs[s];
    var code = String(song['곡코드'] || '').trim();
    var display = String(song['표시명'] || '').trim();
    if (!display) continue;
    if (code) byCode[code] = display;
    var bookCode = String(song['집코드'] || '').trim();
    if (bookCode) byBookAndTitle[bookCode + '|' + normalizeTitle_(song['제목'])] = display;
  }

  var links = readSheet_(ss, 'practice_links', tz);
  var seen = {};
  for (var l = 0; l < links.length; l++) {
    seen[String(links[l]['표시명']) + '|' + String(links[l]['파트'])] = true;
  }

  var toAppend = [];
  var failures = [];

  for (var c = 0; c < cache.length; c++) {
    var entry = cache[c];
    var bookCode = parsePlaylistBook_(entry['재생목록명']);
    var parsed = parseVideoTitle_(entry['제목']);

    if (!bookCode || !parsed.part) {
      failures.push(entry['재생목록명'] + ' / ' + entry['제목']);
      continue;
    }

    // 1순위: 집번호 + 곡번호. 2순위: 집번호 + 곡명 정규화.
    var display = null;
    if (parsed.number) {
      display = byCode[bookCode + '-' + padNumber_(parsed.number)] || null;
    }
    if (!display && parsed.title) {
      display = byBookAndTitle[bookCode + '|' + normalizeTitle_(parsed.title)] || null;
    }

    if (!display) {
      failures.push(entry['재생목록명'] + ' / ' + entry['제목']);
      continue;
    }

    var key = display + '|' + parsed.part;
    if (seen[key]) continue; // 중복은 skip. 기존 행을 건드리지 않는다.
    seen[key] = true;

    toAppend.push([display, parsed.part, 'https://youtu.be/' + entry['videoId'], '', '', 'youtube_channel', false]);
  }

  if (toAppend.length) {
    var sheet = ss.getSheetByName('practice_links');
    sheet.getRange(sheet.getLastRow() + 1, 1, toAppend.length, 7).setValues(toAppend);
  }

  writeReport_(ss, failures);

  ui.alert(
    '영상 매칭 완료',
    '추가 ' + toAppend.length + '개 (전부 검증 대기)\n매칭 실패 ' + failures.length + '건\n\n' +
      (failures.length ? '_매칭실패 시트에 실패 목록을 적었습니다. ' : '') +
      '추가된 링크는 사람이 재생을 확인해 검증 열을 체크하기 전까지 공지에 나가지 않습니다.',
    ui.ButtonSet.OK
  );
}

/** "[중앙아트] 중앙성가 41집" → "중41". 시리즈가 늘어나면 여기에 규칙을 추가한다. */
function parsePlaylistBook_(playlistName) {
  var name = String(playlistName || '');
  var m = name.match(/중앙성가\s*(\d+)\s*집/);
  if (m) return '중' + parseInt(m[1], 10);
  return null;
}

/**
 * 영상 제목에서 곡번호·곡명·파트를 뽑는다.
 *
 * ※ 이 규칙은 잠정이다. 실제 채널의 제목 형식은 미러링을 한 번 돌려 yt_cache를
 *   눈으로 확인한 뒤에 확정해야 한다 (§11 미결정). 규칙을 고치고 "영상 매칭"을
 *   다시 실행하면 되고, API 할당량은 들지 않는다.
 */
function parseVideoTitle_(rawTitle) {
  var title = String(rawTitle || '');

  var part = null;
  var PART_PATTERNS = [
    [/(소프라노|sop|soprano)/i, '소프라노'],
    [/(알토|alt|alto)/i, '알토'],
    [/(테너|ten|tenor)/i, '테너'],
    [/(베이스|바리톤|bass)/i, '베이스'],
    [/(반주|피아노|accomp|mr)/i, '반주'],
    [/(합창|전체|full|tutti)/i, '합창']
  ];
  for (var i = 0; i < PART_PATTERNS.length; i++) {
    if (PART_PATTERNS[i][0].test(title)) { part = PART_PATTERNS[i][1]; break; }
  }
  // 파트 표기가 전혀 없으면 합창(전곡) 영상으로 본다.
  if (!part) part = '합창';

  // 대괄호·소괄호 안 채널 태그 제거 후 곡번호를 찾는다.
  var cleaned = title.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').trim();
  var numberMatch = cleaned.match(/(?:^|\s)(\d{1,2})\s*[.\-번]\s*/);
  var number = numberMatch ? parseInt(numberMatch[1], 10) : null;

  var songTitle = cleaned
    .replace(/중앙성가\s*\d+\s*집/g, ' ')
    .replace(/(?:^|\s)\d{1,2}\s*[.\-번]\s*/, ' ')
    .replace(/(소프라노|알토|테너|베이스|바리톤|합창|반주|피아노|전체|soprano|alto|tenor|bass|mr)/gi, ' ')
    // 제목 뒤에 흔히 붙는 안내 문구. 남겨두면 2순위 곡명 매칭이 헛돈다.
    .replace(/(파트\s*연습|파트|연습|음원|영상|풀버전|full)/gi, ' ')
    .replace(/[\s\-—–·]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { number: number, title: songTitle, part: part };
}

/** 제목 정규화 (§9.4). 매칭 전 양쪽에 동일하게 적용한다. */
function normalizeTitle_(value) {
  return String(value || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/\([^)]*\)/g, '')
    // 전각 영숫자를 반각으로.
    .replace(/[！-～]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xfee0); })
    .replace(/[\s·・\-—–_'"'''""!?,.]/g, '')
    .replace(/^0+/, '')
    .toLowerCase();
}

function padNumber_(n) {
  return n < 10 ? '0' + n : String(n);
}

function writeReport_(ss, failures) {
  var sheet = ss.getSheetByName('_매칭실패') || ss.insertSheet('_매칭실패');
  sheet.clear();
  sheet.getRange(1, 1, 1, 1).setValues([['매칭하지 못한 영상 (재생목록명 / 제목)']]).setFontWeight('bold');
  if (failures.length) {
    sheet.getRange(2, 1, failures.length, 1).setValues(failures.map(function (f) { return [f]; }));
  }
}

function readConfigValue_(ss, key) {
  var sheet = ss.getSheetByName('config');
  if (!sheet || sheet.getLastRow() < 2) return '';
  var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) return String(rows[i][1]).trim();
  }
  return '';
}

/**
 * 신규 악보집 등록 (§9.4).
 * 채널 재생목록에서 수록곡을 찾고, 없으면 목차 붙여넣기로 폴백한다.
 */
function registerBookPrompt() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('악보집 등록', '중앙성가 권 번호를 입력하세요 (예: 50)', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var volume = parseInt(response.getResponseText(), 10);
  if (!volume || volume < 1) {
    ui.alert('권 번호를 숫자로 입력해 주세요.');
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var bookCode = '중' + volume;
  ensureBookRow_(ss, bookCode, volume);

  var entries = songsFromCache_(ss, bookCode);
  if (!entries.length) {
    var pasted = ui.prompt(
      '수록곡 목록',
      bookCode + '의 재생목록을 캐시에서 찾지 못했습니다.\n' +
        '목차를 붙여넣으세요. 한 줄에 "번호<탭>곡명" 또는 "번호. 곡명" 형식 모두 됩니다.',
      ui.ButtonSet.OK_CANCEL
    );
    if (pasted.getSelectedButton() !== ui.Button.OK) return;
    entries = parsePastedToc_(pasted.getResponseText());
  }

  var added = appendSongs_(ss, bookCode, entries);
  ui.alert(
    '악보집 등록 완료',
    bookCode + ' · ' + added + '곡 추가 (전부 상태=후보, 검증=FALSE)\n\n' +
      '이어서 "영상 매칭"을 실행하면 파트 영상이 검증 대기 상태로 채워집니다.',
    ui.ButtonSet.OK
  );
}

function ensureBookRow_(ss, bookCode, volume) {
  var sheet = ss.getSheetByName('books');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (sheet.getLastRow() > 1) {
    var codes = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0]).trim() === bookCode) return;
    }
  }
  var row = headers.map(function (header) {
    switch (String(header).trim()) {
      case '집코드': return bookCode;
      case '시리즈': return '중앙성가';
      case '권': return volume;
      case '출판사': return '중앙아트';
      case '성부': return 'SATB';
      case '보유': return true;
      default: return '';
    }
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
}

function songsFromCache_(ss, bookCode) {
  var cache = readSheet_(ss, 'yt_cache', ss.getSpreadsheetTimeZone());
  var found = {};
  for (var i = 0; i < cache.length; i++) {
    if (parsePlaylistBook_(cache[i]['재생목록명']) !== bookCode) continue;
    var parsed = parseVideoTitle_(cache[i]['제목']);
    if (!parsed.number || !parsed.title) continue;
    if (!found[parsed.number]) found[parsed.number] = parsed.title;
  }
  return Object.keys(found)
    .map(function (n) { return { number: parseInt(n, 10), title: found[n] }; })
    .sort(function (a, b) { return a.number - b.number; });
}

function parsePastedToc_(text) {
  var out = [];
  var lines = String(text || '').split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var m = line.match(/^(\d{1,3})\s*(?:[.\t)\-]|\s)\s*(.+)$/);
    if (!m) continue;
    var title = m[2].trim();
    if (title) out.push({ number: parseInt(m[1], 10), title: title });
  }
  return out;
}

function appendSongs_(ss, bookCode, entries) {
  if (!entries.length) return 0;
  var sheet = ss.getSheetByName('songs');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  var existing = {};
  var codeCol = columnIndex_(sheet, '곡코드');
  if (codeCol && sheet.getLastRow() > 1) {
    var codes = sheet.getRange(2, codeCol, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) existing[String(codes[i][0]).trim()] = true;
  }

  // 곡코드·표시명은 songs 시트의 ARRAYFORMULA가 채운다. 그 열에 값을 쓰면
  // (빈 문자열이라도) 배열 수식이 #REF!로 깨지므로, 그 두 열은 건드리지 않는다.
  var FORMULA_COLUMNS = { '곡코드': true, '표시명': true };

  var rows = [];
  for (var e = 0; e < entries.length; e++) {
    var code = bookCode + '-' + padNumber_(entries[e].number);
    if (existing[code]) continue; // 중복은 곡코드로 skip (§9.3).
    existing[code] = true;
    rows.push(buildSongRow_(headers, bookCode, entries[e], FORMULA_COLUMNS));
  }

  if (!rows.length) return 0;

  var startRow = sheet.getLastRow() + 1;
  // 수식 열을 건너뛰고 연속 구간 단위로만 쓴다.
  var segmentStart = -1;
  for (var c = 0; c <= headers.length; c++) {
    var isFormula = c === headers.length || FORMULA_COLUMNS[String(headers[c]).trim()];
    if (!isFormula && segmentStart === -1) {
      segmentStart = c;
    } else if (isFormula && segmentStart !== -1) {
      var width = c - segmentStart;
      var slice = rows.map(function (row) { return row.slice(segmentStart, c); });
      sheet.getRange(startRow, segmentStart + 1, rows.length, width).setValues(slice);
      segmentStart = -1;
    }
  }

  return rows.length;
}

function buildSongRow_(headers, bookCode, entry, formulaColumns) {
  return headers.map(function (header) {
    var name = String(header).trim();
    if (formulaColumns[name]) return '';
    switch (name) {
      case '제목': return entry.title;
      case '집코드': return bookCode;
      case '수록번호': return entry.number;
      case '성부': return 'SATB';
      case '상태': return '후보';
      case '출처': return 'youtube_channel';
      case '검증': return false;
      default: return '';
    }
  });
}

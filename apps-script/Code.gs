/**
 * JSON 엔드포인트 (§2, §12.2).
 *
 * 배포: 실행 주체 "나", 액세스 권한 "모든 사용자". 시트 자체는 비공개로 유지된다.
 * 대원들은 카톡 링크로 로그인 없이 앱을 열고, 앱은 이 URL 하나만 호출한다.
 *
 * GET은 읽기 전용이고 누구나 부른다. POST는 "다음 찬양으로" 한 동작만 받고,
 * 스크립트 속성에 둔 편집 키가 맞아야 쓴다 (아래 doPost). 그 외에는 쓰지 않는다.
 */

/**
 * 스크립트가 스프레드시트에 연결되어 있지 않은(독립 실행형) 경우에만 채운다.
 * 컨테이너 바인딩 스크립트면 비워 둔다.
 */
var SHEET_ID = '';

/** 모든 파일이 이 함수로만 스프레드시트를 잡는다. */
function getSpreadsheet_() {
  var ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('스프레드시트를 찾지 못했습니다. Code.gs의 SHEET_ID를 채우세요.');
  return ss;
}

/** JSON에 내보낼 데이터 시트. config의 `데이터시트목록`이 있으면 그 값이 이긴다. */
var DEFAULT_DATA_SHEETS = ['books', 'songs', 'services', 'rehearsals', 'practice_links', 'config'];

/** 시트 이름 → 응답 키. 목록에 없는 시트는 시트 이름을 그대로 키로 쓴다. */
var RESPONSE_KEYS = {
  books: 'books',
  songs: 'songs',
  services: 'services',
  rehearsals: 'rehearsals',
  practice_links: 'practiceLinks',
  config: 'config'
};

/** 내부용이라 응답에 절대 넣지 않는 시트 (§4.7). */
var NEVER_EXPORT = ['yt_cache'];

function doGet() {
  var payload;
  try {
    payload = buildPayload_();
  } catch (err) {
    payload = { error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}

function buildPayload_() {
  var ss = getSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';
  var sheetNames = resolveDataSheets_(ss);

  var payload = { updatedAt: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX") };

  for (var i = 0; i < sheetNames.length; i++) {
    var name = sheetNames[i];
    if (NEVER_EXPORT.indexOf(name) !== -1) continue;
    var key = RESPONSE_KEYS[name] || name;
    payload[key] = readSheet_(ss, name, tz);
  }

  // 화이트리스트에 없더라도 이 여섯 키는 항상 존재해야 앱이 빈 화면을 안 띄운다.
  var required = ['books', 'songs', 'services', 'rehearsals', 'practiceLinks', 'config'];
  for (var j = 0; j < required.length; j++) {
    if (!payload[required[j]]) payload[required[j]] = [];
  }

  return payload;
}

/**
 * config의 `데이터시트목록`을 우선한다. 이 값이 있으면 연도 뷰 탭(§3)이 몇 개 늘어나도
 * 스크립트가 건드리지 않는다.
 */
function resolveDataSheets_(ss) {
  var configSheet = ss.getSheetByName('config');
  if (configSheet) {
    var rows = readSheet_(ss, 'config', ss.getSpreadsheetTimeZone());
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i]['키']).trim() === '데이터시트목록') {
        var list = String(rows[i]['값'])
          .split(',')
          .map(function (s) { return s.trim(); })
          .filter(function (s) { return s.length > 0; });
        if (list.length) return list;
      }
    }
  }
  return DEFAULT_DATA_SHEETS;
}

/** config 시트에 있지만 GET 응답에는 절대 넣지 않는 키. 앱을 여는 누구나 그 응답을 본다. */
var CONFIG_SECRET_KEYS = ['앱편집키'];

/**
 * 헤더 행의 이름을 키로 쓴다 (§원칙). 열 위치에 의존하지 않으므로
 * 편집자가 열을 삽입·삭제해도 앱이 깨지지 않는다.
 *
 * config의 비밀 행은 기본으로 뺀다. 스크립트 안에서 그 값이 필요할 때만 includeSecrets를 켠다.
 */
function readSheet_(ss, name, tz, includeSecrets) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var obj = {};
    var hasValue = false;

    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue; // 이름 없는 열은 무시한다.
      var value = normalizeCell_(row[c], tz);
      obj[headers[c]] = value;
      if (value !== '') hasValue = true;
    }

    if (!hasValue) continue;
    if (name === 'config' && !includeSecrets && CONFIG_SECRET_KEYS.indexOf(String(obj['키']).trim()) !== -1) continue;
    out.push(obj);
  }
  return out;
}

/**
 * Date를 시트 시간대의 문자열로 바꾼다.
 *
 * JSON.stringify는 Date를 UTC ISO로 바꾼다. 시트 시간대가 UTC+ 지역이면 자정이
 * 전날로 넘어가 클라이언트가 그냥 자를 때 날짜가 하루 밀리고, PDT/PST처럼 UTC- 지역이면
 * 밀리지는 않지만 시각이 어긋난다. 어느 쪽이든 여기서 확정하는 것이 옳다.
 * 날짜/시각 구분은 시트 에폭(1899-12-30)인지로 판정한다 — 시각 전용 셀이 그 날짜를 쓴다.
 */
function normalizeCell_(value, tz) {
  if (value === null || value === undefined) return '';

  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) return '';
    var y = Number(Utilities.formatDate(value, tz, 'yyyy'));
    if (y <= 1900) return Utilities.formatDate(value, tz, 'HH:mm');
    var hhmm = Utilities.formatDate(value, tz, 'HH:mm');
    var ymd = Utilities.formatDate(value, tz, 'yyyy-MM-dd');
    // 자정이면 날짜 셀로 본다. 시각이 붙어 있으면 둘 다 보존한다.
    return hhmm === '00:00' ? ymd : ymd + 'T' + hhmm;
  }

  if (typeof value === 'string') return value.trim();
  return value;
}

/**
 * 시트 메뉴. 총무가 스크립트 편집기를 열지 않고 쓸 수 있게 한다.
 *
 * onOpen은 프로젝트 전체에서 **하나만** 있어야 한다. Apps Script의 .gs 파일들은
 * 전역 스코프를 공유하므로, 다른 파일에 같은 이름이 또 있으면 오류 없이
 * 나중 파일이 이기고 메뉴 하나가 통째로 사라진다.
 *
 * 항목 순서는 실제 작업 순서를 따른다:
 * 시트 준비 → 채널 동기화 → 제목 확인 → 매칭 → 악보집 등록.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('성가 아카이브')
    .addItem('시트 초기 생성', 'setupSheets')
    .addItem('연도 뷰 탭 만들기', 'createYearViewPrompt')
    .addSeparator()
    .addItem('채널 동기화', 'syncChannel')
    .addItem('제목 형식 확인', 'sampleTitles')
    .addItem('캐시 점검', 'cacheReport')
    .addItem('재생목록 직접 추가', 'addPlaylistPrompt')
    .addItem('영상 매칭', 'matchVideos')
    .addItem('악보집 일괄 등록', 'registerOwnedBooks')
    .addItem('악보집 등록 (한 권)', 'registerBookPrompt')
    .addSeparator()
    .addItem('엔드포인트 점검', 'validateData')
    .addItem('캐시 비우기', 'clearCache')
    .addToUi();
}

/* ------------------------------------------------------------------------ */
/* 쓰기 (§12.2) — 동작은 둘뿐이다.                                                */
/*   applyPlan   찬양일 하나에 곡·연습을 추가 ("다음 찬양으로", "시트에 반영")      */
/*   verifyLink  파트 영상 한 줄의 검증 체크를 켜거나 끈다 (곡 상세의 "확인")        */
/* ------------------------------------------------------------------------ */

/**
 * 편집 키는 config 시트의 `앱편집키` 행이다. 총무가 다른 설정과 같은 자리에서 바꾼다.
 * 행이 없으면 기본값 `selah`. 대소문자는 가리지 않는다 — 폰에서 첫 글자가 대문자로 바뀌는 일이 흔하다.
 *
 * config 시트는 GET으로 통째로 나가므로 이 행만은 내보내기에서 뺀다 (readSheet_ 아래 CONFIG_SECRET_KEYS).
 * 앱은 이 키를 사용자가 한 번 입력해 브라우저에만 남긴다.
 */
var WRITE_KEY_CONFIG = '앱편집키';
var WRITE_KEY_DEFAULT = 'selah';

function normalizeWriteKey_(value) {
  return String(value === null || value === undefined ? '' : value).trim().toLowerCase();
}

function expectedWriteKey_(ss) {
  var rows = readSheet_(ss, 'config', ss.getSpreadsheetTimeZone(), true);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['키']).trim() === WRITE_KEY_CONFIG) {
      var value = normalizeWriteKey_(rows[i]['값']);
      return value || WRITE_KEY_DEFAULT;
    }
  }
  return WRITE_KEY_DEFAULT;
}

/**
 * 브라우저는 preflight를 피하려고 text/plain으로 보낸다. 본문은 JSON이다.
 *   { key, action: 'applyPlan',  payload: { 찬양일, 예배구분, 곡: [표시명…], rehearsals: [{연습일, 시각, 구분, 장소}] } }
 *   { key, action: 'verifyLink', payload: { 표시명, 파트, URL, 검증: true|false } }
 * 응답은 언제나 JSON이고, 실패도 { ok: false, error } 로 200에 실어 보낸다 —
 * Apps Script는 상태 코드를 고를 수 없고, 앱은 어차피 본문을 읽어야 이유를 안다.
 */
function doPost(e) {
  var result;
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    result = handleWrite_(JSON.parse(raw));
  } catch (err) {
    result = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function handleWrite_(body) {
  var ss = getSpreadsheet_();
  if (normalizeWriteKey_(body && body.key) !== expectedWriteKey_(ss)) {
    return { ok: false, error: '편집 키가 맞지 않습니다. config 시트의 앱편집키 값을 확인하세요.' };
  }
  var action = body && body.action;
  if (action !== 'applyPlan' && action !== 'verifyLink') {
    return { ok: false, error: '알 수 없는 요청입니다: ' + String(action) };
  }

  // 두 사람이 같은 순간에 누르면 같은 찬양일 행이 둘 생긴다. 잠그고 하나씩 처리한다.
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, error: '다른 쓰기가 진행 중입니다. 잠시 후 다시 시도하세요.' };
  }
  try {
    var payload = body.payload || {};
    return action === 'verifyLink' ? verifyLink_(ss, payload) : applyPlan_(ss, payload);
  } finally {
    lock.releaseLock();
  }
}

/**
 * practice_links 한 줄의 `검증`을 켜거나 끈다 (§9.3의 "사람이 재생해 보고 체크").
 *
 * 줄은 (표시명, 파트, URL) 셋으로 찾는다 — 같은 곡·파트에 링크가 둘일 수 있어 URL까지 봐야 한다.
 * 바꾸는 것은 `검증` 칸 하나뿐이다. 켜는 것만이 아니라 끄는 것도 받는다 —
 * 틀린 영상을 확인 처리한 실수를 폰에서 바로 되돌릴 수 있어야 한다.
 */
function verifyLink_(ss, payload) {
  var 표시명 = String(payload['표시명'] || '').trim();
  var 파트 = String(payload['파트'] || '').trim();
  var URL = String(payload['URL'] || '').trim();
  var 검증 = payload['검증'] !== false;
  if (!표시명 || !파트 || !URL) return { ok: false, error: '표시명·파트·URL이 모두 있어야 합니다.' };

  var sheet = ss.getSheetByName('practice_links');
  if (!sheet) return { ok: false, error: 'practice_links 시트가 없습니다.' };
  var headers = sheetHeaders_(sheet);
  var nameCol = headers.indexOf('표시명');
  var partCol = headers.indexOf('파트');
  var urlCol = headers.indexOf('URL');
  var verifiedCol = headers.indexOf('검증');
  if (nameCol === -1 || partCol === -1 || urlCol === -1 || verifiedCol === -1) {
    return { ok: false, error: 'practice_links 시트에 표시명/파트/URL/검증 열이 없습니다.' };
  }

  var lastRow = sheet.getLastRow();
  var updated = 0;
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var r = 0; r < values.length; r++) {
      if (String(values[r][nameCol]).trim() !== 표시명) continue;
      if (String(values[r][partCol]).trim() !== 파트) continue;
      if (String(values[r][urlCol]).trim() !== URL) continue;
      sheet.getRange(r + 2, verifiedCol + 1).setValue(검증);
      updated++;
    }
  }
  if (!updated) {
    return { ok: false, error: 'practice_links에서 그 줄을 찾지 못했습니다: ' + 표시명 + ' / ' + 파트 + '. 시트에서 URL이 바뀌었으면 새로고침하세요.' };
  }
  return { ok: true, updated: updated, 검증: 검증 };
}

/**
 * 한 찬양일에 곡과 연습 일정을 넣는다. **append와 빈 칸 채우기만** 한다.
 *
 * - 같은 (찬양일, 예배구분) 행이 있으면 새 행을 만들지 않고 빈 곡N 칸을 채운다.
 *   이미 있는 곡은 건너뛰고, 세 칸이 다 차 있으면 거부한다.
 * - 연습은 같은 (연습일, 시각)이 이미 있으면 넣지 않는다.
 * - 기존 값은 어떤 경우에도 지우거나 바꾸지 않는다. 되돌리기는 시트 버전 기록으로 한다.
 *
 * 곡명은 songs의 표시명에 실재해야 한다 (§12.2 주의) — 드롭다운을 우회하는 경로이므로
 * 여기서 직접 확인한다. 날짜는 시트 시간대의 자정 Date로 넣어 손으로 친 행과 같은 모양이 되게 한다.
 */
function applyPlan_(ss, payload) {
  var tz = ss.getSpreadsheetTimeZone() || 'America/Los_Angeles';

  var 찬양일 = String(payload['찬양일'] || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(찬양일)) return { ok: false, error: '찬양일이 날짜(YYYY-MM-DD)가 아닙니다: ' + 찬양일 };
  var 예배구분 = String(payload['예배구분'] || '').trim() || '주일';

  var titles = [];
  var seenTitle = {};
  (Array.isArray(payload['곡']) ? payload['곡'] : []).forEach(function (t) {
    var title = String(t || '').trim();
    if (title && !seenTitle[title]) {
      seenTitle[title] = true;
      titles.push(title);
    }
  });
  if (!titles.length) return { ok: false, error: '곡이 없습니다.' };
  if (titles.length > 3) return { ok: false, error: '곡은 한 찬양일에 3개까지입니다.' };

  var rehearsals = [];
  (Array.isArray(payload['rehearsals']) ? payload['rehearsals'] : []).forEach(function (r) {
    var 연습일 = String((r && r['연습일']) || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(연습일)) return;
    rehearsals.push({
      연습일: 연습일,
      시각: String((r && r['시각']) || '').trim(),
      구분: String((r && r['구분']) || '').trim(),
      장소: String((r && r['장소']) || '').trim()
    });
  });

  // 1) 곡명이 songs에 있는지.
  var known = {};
  readSheet_(ss, 'songs', tz).forEach(function (row) {
    var display = String(row['표시명'] || '').trim();
    if (display) known[display] = true;
  });
  var unknown = titles.filter(function (t) { return !known[t]; });
  if (unknown.length) return { ok: false, error: 'songs 시트에 없는 곡입니다: ' + unknown.join(', ') };

  // 드롭다운 원본 범위가 만들어질 때의 행 수로 굳어 있으면 새 곡이 걸린다. 규칙만 다시 심는다.
  installValidations_(ss);

  var serviceSheet = ss.getSheetByName('services');
  var rehearsalSheet = ss.getSheetByName('rehearsals');
  if (!serviceSheet || !rehearsalSheet) return { ok: false, error: 'services 또는 rehearsals 시트가 없습니다.' };

  var result = { ok: true, service: 'created', songsAdded: [], songsSkipped: [], rehearsalsAdded: 0, rehearsalsSkipped: 0 };

  // 2) services — 같은 날 행이 있으면 빈 곡 칸을 채우고, 없으면 새 행.
  var serviceHeaders = sheetHeaders_(serviceSheet);
  var songCols = ['곡1', '곡2', '곡3'].map(function (h) { return serviceHeaders.indexOf(h); });
  if (serviceHeaders.indexOf('찬양일') === -1 || songCols[0] === -1) {
    return { ok: false, error: 'services 시트에 찬양일/곡1 열이 없습니다.' };
  }

  var existingRow = findServiceRow_(serviceSheet, serviceHeaders, 찬양일, 예배구분, tz);
  if (existingRow) {
    result.service = 'updated';
    var current = songCols.map(function (c) { return c === -1 ? '' : String(existingRow.values[c] || '').trim(); });
    var toAdd = titles.filter(function (t) {
      if (current.indexOf(t) !== -1) { result.songsSkipped.push(t); return false; }
      return true;
    });
    var empties = [];
    songCols.forEach(function (c, i) { if (c !== -1 && !current[i]) empties.push(c); });
    if (toAdd.length > empties.length) {
      return { ok: false, error: formatDateForMessage_(찬양일) + ' ' + 예배구분 + ' 행에 빈 곡 칸이 ' + empties.length + '개뿐입니다. 시트에서 직접 고치세요.' };
    }
    toAdd.forEach(function (t, i) {
      serviceSheet.getRange(existingRow.rowNumber, empties[i] + 1).setValue(t);
      result.songsAdded.push(t);
    });
  } else {
    var newRow = serviceHeaders.map(function (header) {
      switch (String(header).trim()) {
        case '찬양일': return sheetDate_(찬양일, tz);
        case '예배구분': return 예배구분;
        case '곡1': return titles[0] || '';
        case '곡2': return titles[1] || '';
        case '곡3': return titles[2] || '';
        default: return '';
      }
    });
    serviceSheet.getRange(serviceSheet.getLastRow() + 1, 1, 1, newRow.length).setValues([newRow]);
    result.songsAdded = titles.slice();
  }

  // 3) rehearsals — 같은 (연습일, 시각)은 넣지 않는다.
  if (rehearsals.length) {
    var rehearsalHeaders = sheetHeaders_(rehearsalSheet);
    var have = {};
    readSheet_(ss, 'rehearsals', tz).forEach(function (row) {
      if (String(row['찬양일'] || '').trim() !== 찬양일) return;
      have[String(row['연습일'] || '').trim() + '|' + String(row['시각'] || '').trim()] = true;
    });
    var rows = [];
    rehearsals.forEach(function (r) {
      var key = r.연습일 + '|' + r.시각;
      if (have[key]) { result.rehearsalsSkipped++; return; }
      have[key] = true;
      rows.push(rehearsalHeaders.map(function (header) {
        switch (String(header).trim()) {
          case '찬양일': return sheetDate_(찬양일, tz);
          case '연습일': return sheetDate_(r.연습일, tz);
          case '시각': return r.시각;
          case '구분': return r.구분;
          case '장소': return r.장소;
          default: return '';
        }
      }));
    });
    if (rows.length) {
      rehearsalSheet.getRange(rehearsalSheet.getLastRow() + 1, 1, rows.length, rehearsalHeaders.length).setValues(rows);
      result.rehearsalsAdded = rows.length;
    }
  }

  return result;
}

function sheetHeaders_(sheet) {
  if (sheet.getLastColumn() < 1) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
}

/** 같은 (찬양일, 예배구분) 행. 날짜 셀은 normalizeCell_로 문자열이 된 뒤 비교한다. */
function findServiceRow_(sheet, headers, 찬양일, 예배구분, tz) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var dateCol = headers.indexOf('찬양일');
  var kindCol = headers.indexOf('예배구분');
  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var r = 0; r < values.length; r++) {
    var date = String(normalizeCell_(values[r][dateCol], tz)).slice(0, 10);
    if (date !== 찬양일) continue;
    var kind = kindCol === -1 ? '' : String(normalizeCell_(values[r][kindCol], tz)).trim();
    if (kind !== 예배구분) continue;
    return { rowNumber: r + 2, values: values[r] };
  }
  return null;
}

/** 'YYYY-MM-DD' → 시트 시간대의 자정 Date. 손으로 친 날짜 셀과 같은 모양이 된다. */
function sheetDate_(key, tz) {
  return Utilities.parseDate(key, tz, 'yyyy-MM-dd');
}

function formatDateForMessage_(key) {
  var m = String(key).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? Number(m[2]) + '월 ' + Number(m[3]) + '일' : key;
}

/**
 * 배포 전 자가 점검. 앱이 이상하게 보일 때 시트 쪽 원인을 먼저 걸러낸다.
 * 결과는 대화상자로 보여주고, 데이터는 바꾸지 않는다.
 */
function validateData() {
  var ss = getSpreadsheet_();
  var tz = ss.getSpreadsheetTimeZone();
  var problems = [];

  var sheets = resolveDataSheets_(ss);
  for (var i = 0; i < sheets.length; i++) {
    if (!ss.getSheetByName(sheets[i])) problems.push('시트 없음: ' + sheets[i]);
  }

  var songs = readSheet_(ss, 'songs', tz);
  var displayNames = {};
  for (var s = 0; s < songs.length; s++) {
    var display = String(songs[s]['표시명'] || '').trim();
    if (display) displayNames[display] = true;
  }

  // 드롭다운을 우회해 손으로 친 곡명은 여기서만 드러난다.
  var services = readSheet_(ss, 'services', tz);
  for (var v = 0; v < services.length; v++) {
    ['곡1', '곡2', '곡3'].forEach(function (col) {
      var title = String(services[v][col] || '').trim();
      if (title && !displayNames[title]) {
        problems.push('services의 곡명이 songs에 없음: "' + title + '" (' + services[v]['찬양일'] + ')');
      }
    });
  }

  var links = readSheet_(ss, 'practice_links', tz);
  var unverified = 0;
  for (var l = 0; l < links.length; l++) {
    var name = String(links[l]['표시명'] || '').trim();
    if (name && !displayNames[name]) problems.push('practice_links의 곡명이 songs에 없음: "' + name + '"');
    if (!toBool_(links[l]['검증'])) unverified++;
  }

  var serviceDates = {};
  for (var d = 0; d < services.length; d++) {
    var key = String(services[d]['찬양일']) + '|' + String(services[d]['예배구분'] || '');
    if (serviceDates[key]) problems.push('찬양일 중복: ' + key);
    serviceDates[key] = true;
  }

  var summary =
    '곡 ' + songs.length + ' · 예배 ' + services.length + ' · 링크 ' + links.length +
    '\n미검증 링크 ' + unverified + '개 (공지에서 제외됨)\n\n' +
    (problems.length ? '문제 ' + problems.length + '건\n\n' + problems.slice(0, 30).join('\n') : '발견된 문제 없음');

  SpreadsheetApp.getUi().alert('엔드포인트 점검', summary, SpreadsheetApp.getUi().ButtonSet.OK);
}

function toBool_(v) {
  if (v === true) return true;
  var s = String(v).trim().toLowerCase();
  return s === 'true' || s === 'y' || s === 'yes' || s === '1' || s === '예';
}

/**
 * 시트 초기 생성 (§4).
 *
 * 헤더 행을 만들고 보호를 걸고, 드롭다운(데이터 유효성 검사)과 자동 생성 수식을 넣는다.
 * 곡코드·표시명은 아무도 타이핑하지 않아야 하므로 ARRAYFORMULA로 채우고 열을 보호한다.
 */

var SHEET_SPEC = {
  books: ['집코드', '시리즈', '권', '편저', '출판사', '출판연도', '성부', '표지색', '보유', '보관위치',
    '공식상품URL', '미리듣기URL', '파트연습실URL', '참고문서URL', '비고'],
  songs: ['곡코드', '표시명', '제목', '원제', '집코드', '수록번호', '페이지', '작사', '작곡', '편곡',
    '성부', '조성', '절기', '난이도', '상태', '참고음원URL', '악보스캔URL', '출처', '검증', '비고'],
  services: ['찬양일', '예배구분', '곡1', '곡2', '곡3', 'S인원', 'A인원', 'T인원', 'B인원', '세션',
    '기록영상URL', '메모'],
  rehearsals: ['찬양일', '연습일', '시각', '구분', '장소', '메모'],
  practice_links: ['표시명', '파트', 'URL', '시작초', '올린이', '출처', '검증'],
  config: ['키', '값'],
  yt_cache: ['videoId', '제목', '재생목록명', 'playlistId', '재생목록내순서', '게시일', '수집일시']
};

var CONFIG_DEFAULTS = [
  ['공지_제목형식', '{M}월 {D}일 주일 찬양'],
  ['공지_연습헤더', '<성가연습 일정>'],
  ['공지_곡목표시', 'FALSE'],
  ['공지_빈줄구분', 'FALSE'],
  ['공지_파트순서', '합창,소프라노,알토,테너,베이스,반주'],
  ['앱_제목', '중부워싱턴한인장로교회 성가대'],
  ['교회홈페이지', 'https://www.kpccw.org/'],
  ['예배영상URL', 'https://www.kpccw.org/'],
  ['시간대', 'America/Los_Angeles'],
  ['데이터시트목록', 'books,songs,services,rehearsals,practice_links,config'],
  ['유튜브채널핸들', 'JandAArt'],
  ['유튜브채널ID', ''],
  ['연습기본패턴', '주일 13:30, 수요일 20:00'],
  ['중복경고개월', '12'],
  ['절기힌트', '1:일반, 3:사순, 4:부활, 10:추수감사, 11:대림, 12:성탄']
];

var PARTS = ['합창', '소프라노', '알토', '테너', '베이스', '반주'];
var STATUSES = ['후보', '예정', '연습중', '부름', '보류'];
var SEASONS = ['대림', '성탄', '사순', '부활', '맥추', '추수감사', '일반'];
var SOURCES = ['namuwiki', 'official', 'ocr', 'manual', 'youtube_api', 'youtube_channel'];

function setupSheets() {
  var ss = getSpreadsheet_();

  for (var name in SHEET_SPEC) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    var headers = SHEET_SPEC[name];

    // 이미 있는 시트의 헤더는 덮어쓰지 않는다. 운영 중 데이터를 망가뜨리지 않기 위해서다.
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
    sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn()))
      .setFontWeight('bold')
      .setBackground('#efebe9');
    sheet.setFrozenRows(1);
    protectHeader_(sheet);
  }

  ss.getSheetByName('yt_cache').hideSheet();
  seedConfig_(ss);
  installSongFormulas_(ss);
  installValidations_(ss);

  SpreadsheetApp.getUi().alert(
    '시트 준비 완료',
    '헤더·드롭다운·자동 수식을 넣었습니다.\n\n' +
      '다음 순서를 권합니다 (§9.5):\n' +
      '1. books에 보유 악보집을 먼저 넣으세요 — 이것만으로 앱이 동작합니다.\n' +
      '2. services에 최근 1~2년 찬양 기록을 넣으세요 — 중복 경고가 여기서 나옵니다.\n' +
      '3. 곡 pool은 선곡할 때마다 채워도 됩니다.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/** 헤더 행 보호 (§원칙). 5명이 동시에 만지면 열 삽입·삭제가 반드시 일어난다. */
function protectHeader_(sheet) {
  var existing = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getDescription() === '헤더 행') existing[i].remove();
  }
  var protection = sheet.getRange(1, 1, 1, sheet.getMaxColumns()).protect();
  protection.setDescription('헤더 행');
  protection.setWarningOnly(true);
}

function seedConfig_(ss) {
  var sheet = ss.getSheetByName('config');
  var existing = {};
  if (sheet.getLastRow() > 1) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) existing[String(rows[i][0]).trim()] = true;
  }
  var toAdd = CONFIG_DEFAULTS.filter(function (pair) { return !existing[pair[0]]; });
  if (toAdd.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, toAdd.length, 2).setValues(toAdd);
  }
}

/**
 * 곡코드·표시명 자동 생성 (§4.2).
 * 1행에 ARRAYFORMULA 하나만 두고 열 전체를 보호한다 — 아무도 타이핑하지 않아야 한다.
 */
function installSongFormulas_(ss) {
  var sheet = ss.getSheetByName('songs');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var col = function (name) { return headers.indexOf(name) + 1; };

  var codeCol = col('곡코드');
  var displayCol = col('표시명');
  var bookCol = col('집코드');
  var noCol = col('수록번호');
  var titleCol = col('제목');
  if (!codeCol || !displayCol || !bookCol || !noCol || !titleCol) return;

  var a1 = function (c) { return sheet.getRange(2, c).getA1Notation().replace(/\d+$/, ''); };

  var book = a1(bookCol) + '2:' + a1(bookCol);
  var no = a1(noCol) + '2:' + a1(noCol);
  var title = a1(titleCol) + '2:' + a1(titleCol);
  var code = a1(codeCol) + '2:' + a1(codeCol);

  // 곡코드는 집코드와 수록번호가 **둘 다** 있을 때만 만든다.
  // 수록번호가 비면 TEXT("","00")이 "00"이 되어 "중43-00" 같은 가짜 코드가 생긴다.
  // (ARRAYFORMULA 안에서 OR()는 배열로 퍼지지 않으므로 불리언 덧셈을 쓴다.)
  sheet.getRange(2, codeCol).setFormula(
    '=ARRAYFORMULA(IF((LEN(' + book + ')=0)+(LEN(' + no + ')=0),"",' +
      book + '&"-"&TEXT(' + no + ',"00")))'
  );

  // 표시명은 곡코드가 없으면 제목만 쓴다. 과거 기록을 백필할 때 악보집을 모르는 곡이
  // 많은데, 여기서 "제목 ()"가 나오면 services·practice_links의 드롭다운 값이 전부 그 꼴이 된다.
  sheet.getRange(2, displayCol).setFormula(
    '=ARRAYFORMULA(IF(LEN(' + title + ')=0,"",IF(LEN(' + code + ')=0,' + title + ',' +
      title + '&" ("&' + code + '&")")))'
  );

  [codeCol, displayCol].forEach(function (c) {
    var range = sheet.getRange(2, c, sheet.getMaxRows() - 1, 1);
    var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
    for (var i = 0; i < protections.length; i++) {
      if (protections[i].getDescription() === '자동 생성 열') protections[i].remove();
    }
    var p = range.protect();
    p.setDescription('자동 생성 열');
    p.setWarningOnly(true);
  });
}

/**
 * 드롭다운 (§4.2, §4.5).
 * 곡명 오타를 막는 것이 이 설계의 중심이다 — 단일 파일이라 범위 참조가 파일 경계를 넘지 않는다 (§3).
 */
function installValidations_(ss) {
  var songs = ss.getSheetByName('songs');
  var books = ss.getSheetByName('books');
  var services = ss.getSheetByName('services');
  var rehearsals = ss.getSheetByName('rehearsals');
  var links = ss.getSheetByName('practice_links');

  var displayRange = namedColumnRange_(songs, '표시명');
  var bookRange = namedColumnRange_(books, '집코드');

  if (displayRange) {
    ['곡1', '곡2', '곡3'].forEach(function (name) {
      applyRangeValidation_(services, name, displayRange);
    });
    applyRangeValidation_(links, '표시명', displayRange);
  }
  if (bookRange) applyRangeValidation_(songs, '집코드', bookRange);

  applyListValidation_(songs, '상태', STATUSES);
  applyListValidation_(songs, '절기', SEASONS);
  applyListValidation_(songs, '출처', SOURCES);
  applyListValidation_(links, '파트', PARTS);
  applyListValidation_(links, '출처', SOURCES);
  applyListValidation_(rehearsals, '구분', ['주일', '수요일', '특별']);

  applyCheckbox_(songs, '검증');
  applyCheckbox_(links, '검증');
  applyCheckbox_(books, '보유');
}

function columnIndex_(sheet, name) {
  if (!sheet || sheet.getLastColumn() < 1) return 0;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === name) return i + 1;
  }
  return 0;
}

function bodyRange_(sheet, name) {
  var col = columnIndex_(sheet, name);
  if (!col) return null;
  return sheet.getRange(2, col, sheet.getMaxRows() - 1, 1);
}

function namedColumnRange_(sheet, name) {
  return bodyRange_(sheet, name);
}

function applyRangeValidation_(sheet, name, sourceRange) {
  var range = bodyRange_(sheet, name);
  if (!range) return;
  range.setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireValueInRange(sourceRange, true)
      .setAllowInvalid(false)
      .setHelpText('songs 시트의 표시명 중에서 고르세요. 직접 입력하면 앱에서 곡을 못 찾습니다.')
      .build()
  );
}

function applyListValidation_(sheet, name, values) {
  var range = bodyRange_(sheet, name);
  if (!range) return;
  range.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build()
  );
}

function applyCheckbox_(sheet, name) {
  var range = bodyRange_(sheet, name);
  if (range) range.insertCheckboxes();
}

/**
 * 연도 뷰 탭 (§3).
 * QUERY 한 줄로 자동으로 채워지는 읽기 전용 탭. Apps Script는 이 탭을 내보내지 않는다
 * (config의 데이터시트목록 화이트리스트에 없으므로).
 */
function createYearViewPrompt() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt('연도 뷰 탭 만들기', '연도를 입력하세요 (예: 2026)', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var year = parseInt(response.getResponseText(), 10);
  if (!year || year < 1900 || year > 2200) {
    ui.alert('연도를 숫자로 입력해 주세요.');
    return;
  }
  createYearView(year);
  ui.alert(year + ' 탭을 만들었습니다. 자동으로 채워지며 읽기 전용입니다.');
}

function createYearView(year) {
  var ss = getSpreadsheet_();
  var name = String(year);
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  sheet.clear();
  sheet.getRange('A1').setFormula(
    '=QUERY(services!A:N, "select * where year(A)=' + year + ' order by A", 1)'
  );
  return sheet;
}

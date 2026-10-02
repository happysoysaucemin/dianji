/* 记电 · 登录密码名单（由 tools/make-passwords.js 生成，请勿手工编辑）
   ------------------------------------------------------------------
   这里**只有用户标识 ID 与该成员的凯撒位移**，不含任何 token 片段。
   密码本体 = 交错(ID, 凯撒(token, 位移))，token 不会被写进这个文件。
   ------------------------------------------------------------------ */
(function (global) {
  'use strict';
  var DJ = global.DJ = global.DJ || {};
  DJ.authTable = [
    { by: '郑沐鑫', id: 'C446A4792EE0D86D9F1230424C610BCF', shift: 3 },
    { by: '商叶航', id: '5CEA059E725F5414F4177D42859E4748', shift: 1 },
    { by: '曾昭彬', id: 'C410BFAD1436913C9734A74EF48665AB', shift: 4 },
    { by: '杨子沣', id: '66C699AD2A1F84D8853A36AA38E6AA77', shift: 5 },
    { by: '张梓杭', id: 'B4D6233AE640ADBF41725198DFOD7F97', shift: 6 },
  ];
})(typeof window !== 'undefined' ? window : globalThis);

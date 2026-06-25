// ==UserScript==
// @name         超星测验提取器
// @namespace    https://github.com/chaoxing-quiz-extractor
// @version      1.2
// @description  从超星学习通学生页面抓取所有随堂测验题目，合并生成交互式练习 HTML
// @author       Chaoxing Quiz Extractor
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mycourse/studentstudy?*
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @connect      mooc1.chaoxing.com
// @connect      mooc2-ans.chaoxing.com
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // ===================== 全局状态 =====================
  const HOST = 'https://mooc1.chaoxing.com';
  const HOST_ANS = 'https://mooc2-ans.chaoxing.com';

  let courseId = '';
  let classId = '';
  let cpi = '';
  let courseName = '';

  // 收集的测验数据 [{ chapterTitle, chapterPath, quizzes: [{ title, knowledgeId, questions }] }]
  let allChapters = [];
  let totalQuestions = 0;
  let totalWithAnswers = 0;
  let totalQuizzes = 0;
  let scanDone = false;

  // ===================== DOM 工具 =====================
  function $el(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    if (typeof children === 'string') el.innerHTML = children;
    else if (children) children.forEach(c => el.appendChild(c));
    return el;
  }

  // ===================== UI 面板 =====================
  function injectUI() {
    // 移除已有面板
    const existing = document.getElementById('cxr-panel-v2');
    if (existing) existing.remove();

    const panel = $el('div', { id: 'cxr-panel-v2', style: 'position:fixed;bottom:24px;right:24px;z-index:99999;font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif' });

    const fab = $el('div', { id: 'cxrFabV2', class: 'cxr-fab', title: '测验导出' }, '📋');
    Object.assign(fab.style, {
      width: '52px', height: '52px', borderRadius: '50%', background: '#4f46e5',
      color: '#fff', border: 'none', cursor: 'pointer', fontSize: '22px',
      boxShadow: '0 4px 16px rgba(79,70,229,.35)', transition: 'all .2s',
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    });

    const card = $el('div', { id: 'cxrCardV2', style: 'display:none;position:absolute;bottom:64px;right:0;width:320px;background:#fff;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.16);padding:20px;max-height:520px;overflow-y:auto' });

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <span style="font-size:15px;font-weight:700;color:#1a1a2e">📦 测验提取器</span>
        <button id="cxrCloseV2" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;padding:2px 6px">&times;</button>
      </div>
      <div id="cxrInfoV2" style="font-size:12px;color:#6b7280;margin-bottom:12px;line-height:1.6"></div>
      <div id="cxrBarWrapV2" style="height:5px;background:#e5e7eb;border-radius:3px;overflow:hidden;margin-bottom:8px;display:none">
        <div id="cxrFillV2" style="height:100%;background:linear-gradient(90deg,#4f46e5,#818cf8);width:0%;transition:width .3s;border-radius:3px"></div>
      </div>
      <button id="cxrGoV2" class="cxr-btn-v2" style="display:block;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#4f46e5;color:#fff;margin-bottom:8px">🔍 扫描章节</button>
      <button id="cxrFetchV2" class="cxr-btn-v2" style="display:none;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#059669;color:#fff;margin-bottom:8px">📥 开始抓取题目</button>
      <button id="cxrDownloadV2" class="cxr-btn-v2" style="display:none;width:100%;padding:11px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;background:#ea580c;color:#fff">⬇ 下载练习 HTML</button>
      <div id="cxrLogV2" style="display:none;max-height:160px;overflow-y:auto;font-size:11px;color:#6b7280;line-height:1.6;margin-top:8px;background:#f9fafb;border-radius:8px;padding:8px"></div>
    `;

    panel.appendChild(fab);
    panel.appendChild(card);
    document.body.appendChild(panel);

    // 事件绑定
    let open = false;
    fab.addEventListener('click', () => {
      open = !open;
      card.style.display = open ? 'block' : 'none';
      if (open) updateInfo();
    });
    document.getElementById('cxrCloseV2').addEventListener('click', () => {
      open = false;
      card.style.display = 'none';
    });

    document.getElementById('cxrGoV2').addEventListener('click', scanChapters);
    document.getElementById('cxrFetchV2').addEventListener('click', fetchAllQuizzes);
    document.getElementById('cxrDownloadV2').addEventListener('click', downloadHTML);

    // Hover effect on fab
    fab.addEventListener('mouseenter', () => { fab.style.transform = 'scale(1.08)'; });
    fab.addEventListener('mouseleave', () => { fab.style.transform = 'scale(1)'; });

    return { fab, card };
  }

  function updateInfo() {
    const info = document.getElementById('cxrInfoV2');
    if (scanDone) {
      info.innerHTML = `📂 课程: <b>${escHtml(courseName)}</b><br>📝 测验: <b>${totalQuizzes}</b> 个 | 总题数: <b>${totalQuestions}</b> | 有答案: <b>${totalWithAnswers}</b>`;
    } else if (allChapters.length > 0) {
      info.innerHTML = `🔍 已扫描到 <b>${totalQuizzes}</b> 个测验<br>点击「开始抓取题目」获取详情`;
    } else {
      info.innerHTML = '点击「扫描章节」开始分析页面结构';
    }
  }

  function log(msg, isError) {
    const logDiv = document.getElementById('cxrLogV2');
    logDiv.style.display = 'block';
    const div = document.createElement('div');
    div.textContent = msg;
    if (isError) div.style.color = '#dc2626';
    logDiv.appendChild(div);
    logDiv.scrollTop = logDiv.scrollHeight;
  }

  function setProgress(pct) {
    const bar = document.getElementById('cxrBarWrapV2');
    const fill = document.getElementById('cxrFillV2');
    bar.style.display = 'block';
    fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ===================== 章节扫描 =====================
  function scanChapters() {
    allChapters = [];
    totalQuestions = 0;
    totalWithAnswers = 0;
    totalQuizzes = 0;

    log('🚀 开始扫描章节...');
    document.getElementById('cxrGoV2').textContent = '⏳ 扫描中...';
    document.getElementById('cxrGoV2').disabled = true;
    document.getElementById('cxrBarWrapV2').style.display = 'block';
    document.getElementById('cxrFillV2').style.width = '0%';

    // 从页面中提取 courseId, classId, cpi (多重 fallback)
    // 方法1: 从 script 标签中提取
    const scripts = document.querySelectorAll('script');
    for (const s of scripts) {
      const txt = s.textContent || '';
      if (!cpi) { const m = txt.match(/var\s+stu_cpi\s*=\s*["'](\d+)["']/); if (m) cpi = m[1]; }
      if (!classId) { const m = txt.match(/var\s+stu_clazzId\s*=\s*["'](\d+)["']/); if (m) classId = m[1]; }
      if (!courseId) { const m = txt.match(/var\s+stu_CourseId\s*=\s*["'](\d+)["']/); if (m) courseId = m[1]; }
    }
    // 方法2: 从 URL 参数提取
    const urlParams = new URLSearchParams(location.search);
    if (!cpi) cpi = urlParams.get('cpi') || '';
    if (!classId) classId = urlParams.get('clazzid') || urlParams.get('classId') || '';
    if (!courseId) courseId = urlParams.get('courseId') || urlParams.get('courseid') || '';
    // 方法3: 从全局变量
    if (!cpi && typeof window._cpi !== 'undefined') cpi = String(window._cpi);

    // 获取课程名称
    const titleEl = document.querySelector('.courseName') || document.querySelector('title');
    if (titleEl) courseName = titleEl.textContent.replace(/^\s+|\s+$/g, '').replace(/\n/g, ' ').substring(0, 60);

    // 扫描所有章节节点
    const catalogItems = document.querySelectorAll('.posCatalog_name');
    const chapters = [];
    let chapterStack = [{ title: '根', level: 0 }];

    catalogItems.forEach(el => {
      const onclick = (el.getAttribute('onclick') || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      const match = onclick.match(/getTeacherAjax\s*\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*\)/);
      if (!match) return;

      const cId = match[1];
      const clId = match[2];
      const kId = match[3];
      const title = (el.getAttribute('title') || el.textContent || '').trim();
      const sbar = el.querySelector('.posCatalog_sbar');
      const sectionNum = sbar ? sbar.textContent.trim() : '';

      // 确认是测验节点（标题含测验关键词）
      if (/测验|测试|考试|作业/.test(title)) {
        chapters.push({
          sectionNum,
          chapterTitle: title,
          knowledgeId: kId,
          courseId: cId,
          classId: clId,
          chapterPath: sectionNum + ' ' + title
        });
      }
    });

    totalQuizzes = chapters.length;
    allChapters = chapters.map(c => ({
      ...c,
      quizzes: [{ title: c.chapterTitle, knowledgeId: c.knowledgeId, questions: [], hasAnswers: null, fetched: false }]
    }));

    log(`✅ 扫描完成: ${totalQuizzes} 个测验节点`);
    updateInfo();

    document.getElementById('cxrGoV2').textContent = '🔄 重新扫描';
    document.getElementById('cxrGoV2').disabled = false;
    document.getElementById('cxrFetchV2').style.display = 'block';
    document.getElementById('cxrBarWrapV2').style.display = 'none';
    scanDone = true;

    if (totalQuizzes === 0) {
      log('⚠️ 未找到测验节点，请确认在正确的页面上', true);
    }
  }

  // ===================== API 请求 =====================
  function gmFetch(url, timeout) {
    return new Promise((resolve, reject) => {
      const fullUrl = url.startsWith('http') ? url : HOST + url;
      GM_xmlhttpRequest({
        method: 'GET',
        url: fullUrl,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/json,*/*',
        },
        timeout: timeout || 15000,
        onload: function (resp) {
          if (resp.status >= 200 && resp.status < 400) {
            resolve({ html: resp.responseText, finalUrl: resp.finalUrl || fullUrl, status: resp.status });
          } else {
            reject(new Error(`HTTP ${resp.status}`));
          }
        },
        onerror: function (e) { reject(new Error('Network error: ' + (e.error || 'unknown'))); },
        ontimeout: function () { reject(new Error('Timeout')); }
      });
    });
  }

  // 第1步: 获取 cards 页, 提取 mArg 中的 attachment 数据
  async function fetchCardsPage(knowledgeId) {
    const url = `/mooc-ans/knowledge/cards?clazzid=${classId}&courseid=${courseId}&knowledgeid=${knowledgeId}&num=0&ut=s&cpi=${cpi}&mooc2=1&isMicroCourse=false&editorPreview=0`;
    const resp = await gmFetch(url);
    return resp.html;
  }

  function parseMAttachments(html) {
    // 提取 mArg JSON
    const m = html.match(/mArg\s*=\s*({[\s\S]*?});/);
    if (!m) return null;
    try {
      const mArg = JSON.parse(m[1]);
      const attachments = (mArg.attachments || []).filter(a => a.type === 'workid' && a.property && a.property.workid);
      return {
        attachments,
        defaults: mArg.defaults || {},
        knowledgename: mArg.knowledgename || ''
      };
    } catch (e) {
      return null;
    }
  }

  // 第2步: 获取 work 页面 (可能重定向到已批阅页面)
  async function fetchWorkPage(workid, jobid, enc, knowledgeId, ktoken) {
    const url = `/mooc-ans/api/work?api=1&workId=${workid}&jobid=${jobid}&originJobId=${jobid}&needRedirect=true&skipHeader=true&knowledgeid=${knowledgeId}&ktoken=${ktoken}&cpi=${cpi}&ut=s&clazzId=${classId}&mooc2=1&courseid=${courseId}&enc=${enc}`;
    const resp = await gmFetch(url);
    return resp;
  }

  // ===================== HTML 解析 =====================
  function parseQuestionsFromHTML(html) {
    // 使用 DOMParser 解析
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const questions = [];

    // 查找题目容器
    const qDivs = doc.querySelectorAll('.TiMu.newTiMu');
    if (qDivs.length === 0) {
      // 尝试其他选择器
      const altDivs = doc.querySelectorAll('.TiMu');
      if (altDivs.length === 0) return { questions: [], hasAnswers: false };
    }

    (qDivs.length ? qDivs : doc.querySelectorAll('.TiMu')).forEach((div, idx) => {
      const q = { id: idx + 1 };

      // ── 题型识别（v4：以 newZy_TItle 文本为准，CSS 类名兜底）──
      const typeSpan = div.querySelector('.newZy_TItle');
      const typeHint = typeSpan ? typeSpan.textContent.trim() : '';
      if (/【多选题】|\[多选题\]/.test(typeHint)) q.type = '多选题';
      else if (/【判断题】|\[判断题\]/.test(typeHint)) q.type = '判断题';
      else if (/【填空题】|\[填空题\]/.test(typeHint)) q.type = '填空题';
      else if (/【连线题】|\[连线题\]/.test(typeHint)) q.type = '连线题';
      else if (/【排序题】|\[排序题\]/.test(typeHint)) q.type = '排序题';
      else if (div.classList.contains('multiQuesId')) q.type = '多选题';
      else if (div.classList.contains('trueOrFalseQuesId')) q.type = '判断题';
      else if (div.classList.contains('singleQuesId')) q.type = '单选题';
      else if (div.classList.contains('inputQuesId') || div.querySelector('.Zy_ulTk')) q.type = '填空题';
      else if (div.querySelector('.matching')) q.type = '连线题';
      else if (div.querySelector('.newSort')) q.type = '排序题';
      else q.type = '单选题';  // 最终兜底

      // ── 题干（去除题干开头重复的【xxx】标记）──
      const textEl = div.querySelector('.qtContent p') || div.querySelector('.qtContent');
      if (textEl) {
        q.text = textEl.textContent.replace(/\s+/g, ' ').trim();
      } else {
        const titleDiv = div.querySelector('.Zy_TItle');
        q.text = titleDiv ? titleDiv.textContent.replace(/^\d+\s*/, '').replace(/\s+/g, ' ').trim() : '';
      }
      // 去掉题干中嵌入的题型标记
      q.text = q.text.replace(/^【[^】]+】\s*/, '').trim();

      // ── 选项 ──
      const optionEls = div.querySelectorAll('.Zy_ulTop li');
      if (optionEls.length > 0) {
        q.options = [];
        optionEls.forEach(li => {
          const labelEl = li.querySelector('i');
          const contentEl = li.querySelector('a p') || li.querySelector('a') || li;
          const label = labelEl ? labelEl.textContent.replace(/[、,，\s]$/, '').trim() : '';
          const text = contentEl ? contentEl.textContent.replace(/\s+/g, ' ').trim() : '';
          if (label || text) q.options.push({ label, text: text || label });
        });
      }

      // ── 填空题：记录空数 ──
      if (q.type === '填空题') {
        const tkInputs = div.querySelectorAll('.Zy_ulTk input, .Zy_ulTk textarea, .InpDIV input');
        q.blankCount = tkInputs.length || 1;
      }
      // 判断题无选项时自动生成
      if (q.type === '判断题' && (!q.options || q.options.length === 0)) {
        q.options = [{ label: '对', text: '对 ✓' }, { label: '错', text: '错 ✗' }];
      }

      // ── 正确答案 ──
      const correctDiv = div.querySelector('.correctAnswer .answerCon');
      const myAnswerDiv = div.querySelector('.myAnswer .answerCon');
      if (correctDiv) {
        q.answer = correctDiv.textContent.replace(/\s+/g, ' ').trim();
        q.hasAnswer = true;
      } else if (myAnswerDiv) {
        q.myAnswer = myAnswerDiv.textContent.replace(/\s+/g, ' ').trim();
        q.hasAnswer = false;
        q.answer = '';
      } else {
        q.hasAnswer = false;
        q.answer = '';
      }

      // ── 推断题型（多选答案如 "ABC"）──
      if (q.type === '单选题' && q.answer && /^[A-H]{2,}$/i.test(q.answer) && !/[、,，]/.test(q.answer)) {
        q.type = '多选题';
      }

      // ── 解析 / 知识点 ──
      const kpDiv = div.querySelector('.knowledgePointBx');
      if (kpDiv) {
        const kpLinks = kpDiv.querySelectorAll('.knowledgeList li a');
        if (kpLinks.length > 0) {
          q.knowledge = Array.from(kpLinks).map(a => a.textContent.trim()).filter(Boolean).join(' | ');
        }
      }

      // 分数
      const scoreEl = div.querySelector('.scoreNum');
      if (scoreEl) { q.score = scoreEl.textContent.trim(); }

      // 对错标记
      const markingEl = div.querySelector('.marking_dui, .marking_cuo, .marking_bandui');
      if (markingEl) {
        if (markingEl.classList.contains('marking_dui')) q.isCorrect = true;
        else if (markingEl.classList.contains('marking_cuo')) q.isCorrect = false;
      }

      questions.push(q);
    });

    // 判断是否有正确答案
    const hasAnswers = questions.some(q => q.hasAnswer);
    return { questions, hasAnswers };
  }

  // ===================== 主抓取流程 =====================
  async function fetchAllQuizzes() {
    if (allChapters.length === 0) {
      log('⚠️ 请先扫描章节', true);
      return;
    }

    totalQuestions = 0;
    totalWithAnswers = 0;
    document.getElementById('cxrFetchV2').disabled = true;
    document.getElementById('cxrFetchV2').textContent = '⏳ 抓取中...';
    document.getElementById('cxrLogV2').style.display = 'block';
    log('📥 开始抓取题目数据...');

    const total = allChapters.length;
    let completed = 0;

    for (const chapter of allChapters) {
      const quiz = chapter.quizzes[0];
      if (!quiz || quiz.fetched) {
        completed++;
        continue;
      }

      try {
        log(`  🔍 [${chapter.sectionNum}] ${chapter.chapterTitle}`);

        // Step 1: 获取 cards 页面
        const cardsHtml = await fetchCardsPage(quiz.knowledgeId);
        const mData = parseMAttachments(cardsHtml);

        if (!mData || mData.attachments.length === 0) {
          log(`    ⚠️ 无测验数据`, true);
          quiz.fetched = true;
          quiz.hasAnswers = false;
          chapter.chapterTitle = chapter.sectionNum + ' ' + chapter.chapterTitle;
          completed++;
          setProgress((completed / total) * 100);
          continue;
        }

        // 收集此章节下所有 work 的题目
        let chapterQuestions = [];
        let chapterHasAnswers = false;

        for (const att of mData.attachments) {
          try {
            const workid = att.property.workid;
            const jobid = att.property.jobid || att.jobid;
            const enc = att.enc || '';
            const ktoken = (mData.defaults && mData.defaults.ktoken) || '';

            // Step 2: 获取 work 页面
            const workResp = await fetchWorkPage(workid, jobid, enc, quiz.knowledgeId, ktoken);

            // Step 3: 解析题目
            const result = parseQuestionsFromHTML(workResp.html);

            if (result.questions.length > 0) {
              chapterQuestions = chapterQuestions.concat(result.questions);
              if (result.hasAnswers) chapterHasAnswers = true;
            }
          } catch (e) {
            log(`    ⚠️ 子测验请求失败: ${e.message}`, true);
          }
        }

        quiz.questions = chapterQuestions;
        quiz.hasAnswers = chapterHasAnswers;
        quiz.fetched = true;
        quiz.title = mData.attachments[0] && mData.attachments[0].property.title ?
          mData.attachments[0].property.title : chapter.chapterTitle;

        if (chapterQuestions.length > 0) {
          const ansCount = chapterQuestions.filter(q => q.hasAnswer).length;
          totalQuestions += chapterQuestions.length;
          totalWithAnswers += ansCount;
          log(`    ✅ ${chapterQuestions.length} 题 (${ansCount} 有答案) [${quiz.title}]`);
        } else {
          log(`    📭 无题目`, true);
        }

      } catch (e) {
        log(`    ❌ 抓取失败: ${e.message}`, true);
        quiz.fetched = true;
        quiz.hasAnswers = false;
      }

      completed++;
      setProgress((completed / total) * 100);

      // 请求间延迟避免限流
      await sleep(300 + Math.random() * 400);
    }

    document.getElementById('cxrFetchV2').disabled = false;
    document.getElementById('cxrFetchV2').textContent = '🔄 重新抓取';
    document.getElementById('cxrDownloadV2').style.display = 'block';
    document.getElementById('cxrBarWrapV2').style.display = 'none';
    scanDone = true;
    updateInfo();
    log(`🎉 抓取完成! ${totalQuestions} 题, ${totalWithAnswers} 有答案`);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ===================== HTML 生成（v3: 单题模式 + 双模式 + 错题本 + 成绩记录） =====================
  function generatePracticeHTML() {
    const chaptersWithQuestions = allChapters.filter(c =>
      c.quizzes[0] && c.quizzes[0].questions && c.quizzes[0].questions.length > 0
    );

    if (chaptersWithQuestions.length === 0) {
      alert('没有可导出的题目，请先抓取数据');
      return '';
    }

    let globalId = 0;
    const allQ = [];
    const sections = [];

    chaptersWithQuestions.forEach(ch => {
      const qq = ch.quizzes[0].questions;
      const sectionQuestions = qq.map(q => {
        globalId++;
        return {
          ...q,
          globalId,
          sectionTitle: ch.quizzes[0].title || ch.chapterTitle,
          sectionPath: ch.chapterTitle,
          hasAnswer: q.hasAnswer || false
        };
      });
      sections.push({
        title: ch.quizzes[0].title || ch.chapterTitle,
        path: ch.chapterTitle,
        questions: sectionQuestions,
        hasAnswers: ch.quizzes[0].hasAnswers
      });
      allQ.push(...sectionQuestions);
    });

    const total = allQ.length;
    const withAns = allQ.filter(q => q.hasAnswer).length;

    const questionsJSON = JSON.stringify(allQ.map(q => ({
      id: q.globalId,
      type: q.type,
      text: q.text,
      options: q.options || [],
      answer: q.answer || '',
      hasAnswer: q.hasAnswer,
      knowledge: q.knowledge || '',
      sectionTitle: q.sectionTitle,
      sectionPath: q.sectionPath,
      blankCount: q.blankCount || 0
    })));

    const sectionsJSON = JSON.stringify(sections.map(s => ({
      title: s.title,
      path: s.path,
      hasAnswers: s.hasAnswers,
      questionIds: s.questions.map(q => q.globalId)
    })));

    const labelsStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>练习 - \${escHtml(courseName)}</title>
<style>
:root{--bg:#f0f2f5;--card:#fff;--txt:#1a1a2e;--t2:#6b7280;--pri:#4f46e5;--ok:#059669;--err:#dc2626;--warn:#d97706;--brd:#e5e7eb;--hover:#f3f4f6;--sh:0 2px 8px rgba(0,0,0,.06)}
.dark{--bg:#111827;--card:#1f2937;--txt:#f9fafb;--t2:#9ca3af;--pri:#818cf8;--ok:#34d399;--err:#f87171;--warn:#fbbf24;--brd:#374151;--hover:#374151;--sh:0 2px 8px rgba(0,0,0,.3)}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--txt);min-height:100vh;padding:16px}
.container{max-width:740px;margin:0 auto}

.topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.topbar h1{font-size:20px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px}
.meta{font-size:12px;color:var(--t2)}

.mode-tabs{display:flex;gap:4px;background:var(--card);border-radius:10px;padding:4px;margin-bottom:10px;box-shadow:var(--sh);flex-wrap:wrap}
.mode-tab{flex:1 1 auto;padding:8px 10px;border:none;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;background:transparent;color:var(--t2);transition:all .15s;text-align:center}
.mode-tab.active{background:var(--pri);color:#fff}
.mode-tab:hover:not(.active){background:var(--hover)}

.subbar{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center}
.subbar select,.subbar input,.subbar button{padding:6px 10px;border-radius:7px;font-size:12px;border:1px solid var(--brd);background:var(--card);color:var(--txt);cursor:pointer}
.subbar select{min-width:130px}
.subbar input{flex:1;min-width:120px;cursor:text}
.subbar button{font-weight:600;white-space:nowrap}
.btn-sm{padding:5px 10px;font-size:12px;border-radius:6px;border:none;cursor:pointer;font-weight:600;transition:all .12s}
.btn-sm:active{transform:scale(.96)}
.btn-pri{background:var(--pri);color:#fff}
.btn-out{background:transparent;color:var(--pri);border:1px solid var(--pri)}
.btn-warn{background:var(--warn);color:#fff}
.btn-err{background:var(--err);color:#fff}

.timer{font-size:13px;font-weight:700;color:var(--pri);margin-left:auto;white-space:nowrap}
.timer.urgent{color:var(--err);animation:blink .6s linear infinite}
@keyframes blink{50%{opacity:.4}}

.progress-wrap{margin-bottom:10px}
.progress-bar{height:4px;background:var(--brd);border-radius:2px;overflow:hidden}
.progress-fill{height:100%;background:var(--pri);transition:width .3s;border-radius:2px}
.progress-info{display:flex;justify-content:space-between;font-size:11px;color:var(--t2);margin-top:3px}

.qgrid{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px;max-height:110px;overflow-y:auto;padding:3px}
.qgrid-item{width:28px;height:28px;border-radius:5px;border:1px solid var(--brd);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;cursor:pointer;background:var(--card);color:var(--txt);transition:all .12s}
.qgrid-item.current{border-color:var(--pri);background:#eef2ff;color:var(--pri)}
.dark .qgrid-item.current{background:#312e81}
.qgrid-item.answered{background:#d1fae5;border-color:var(--ok);color:#065f46}
.dark .qgrid-item.answered{background:#064e3b;color:#6ee7b7}
.qgrid-item.wrong-mark{background:#fee2e2;border-color:var(--err);color:#991b1b}
.dark .qgrid-item.wrong-mark{background:#7f1d1d;color:#fca5a5}
.qgrid-item.fav-mark{box-shadow:0 0 0 2px #f59e0b}
.qgrid-item:hover{transform:scale(1.1)}

.card{background:var(--card);border-radius:12px;padding:20px 18px;margin-bottom:10px;box-shadow:var(--sh);min-height:160px;position:relative}
.star-btn{position:absolute;top:10px;right:12px;background:none;border:none;font-size:20px;cursor:pointer;color:#d1d5db;transition:all .15s;z-index:2}
.star-btn.active{color:#f59e0b;filter:drop-shadow(0 0 2px rgba(245,158,11,.5))}
.star-btn:hover{transform:scale(1.2)}

.q-head{display:flex;align-items:baseline;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.q-num{background:var(--pri);color:#fff;min-width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0}
.q-type{font-size:11px;color:var(--pri);background:#eef2ff;padding:2px 7px;border-radius:4px;font-weight:600}
.dark .q-type{background:#312e81;color:#a5b4fc}
.no-ans-tag{font-size:10px;background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;margin-left:4px;vertical-align:middle}
.q-text{font-size:16px;line-height:1.6;font-weight:500}

.options{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.opt{display:flex;align-items:flex-start;padding:9px 12px;border:2px solid var(--brd);border-radius:10px;cursor:pointer;transition:all .12s;font-size:15px;line-height:1.45}
.opt:hover:not(.done){border-color:var(--pri);background:var(--hover)}
.opt .o-label{font-weight:700;color:var(--t2);margin-right:8px;min-width:20px;flex-shrink:0}
.opt .o-check{width:18px;height:18px;border:2px solid var(--brd);border-radius:4px;margin-right:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:transparent;transition:all .12s}
.opt.selected:not(.done){border-color:var(--pri);background:#eef2ff}
.dark .opt.selected:not(.done){background:#312e81}
.opt.selected .o-check{border-color:var(--pri);background:var(--pri);color:#fff}
.opt.correct{border-color:var(--ok);background:#d1fae5}
.dark .opt.correct{background:#064e3b}
.opt.wrong{border-color:var(--err);background:#fee2e2}
.dark .opt.wrong{background:#7f1d1d}
.opt.done{cursor:default}

.fill-row{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.fill-input{width:100%;padding:9px 12px;border:2px solid var(--brd);border-radius:8px;font-size:15px;background:var(--card);color:var(--txt);outline:none}
.fill-input:focus{border-color:var(--pri)}

.confirm-row{display:flex;gap:8px;margin:10px 0}
.confirm-row button{padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer}

.result{margin-top:10px;padding:10px 14px;border-radius:8px;font-size:14px;display:none;line-height:1.5}
.result.show{display:block}
.result.ok{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
.result.err{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
.result.info{background:#dbeafe;color:#1e40af;border:1px solid #bfdbfe}

.flashcard-flip{perspective:600px;min-height:200px;cursor:pointer}
.flashcard-flip .inner{transition:transform .5s;transform-style:preserve-3d;position:relative}
.flashcard-flip.flipped .inner{transform:rotateY(180deg)}
.flash-front,.flash-back{backface-visibility:hidden;padding:20px;border-radius:12px;border:2px solid var(--brd);min-height:180px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:17px;line-height:1.7}
.flash-front{background:var(--card)}
.flash-back{background:#d1fae5;color:#065f46;position:absolute;inset:0;transform:rotateY(180deg);display:flex;flex-direction:column;gap:8px}
.dark .flash-back{background:#064e3b;color:#6ee7b7}

.nav-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.nav-btn{padding:8px 18px;border:2px solid var(--brd);border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:var(--card);color:var(--txt);transition:all .15s}
.nav-btn:hover{border-color:var(--pri);color:var(--pri)}
.nav-btn:disabled{opacity:.35;cursor:not-allowed}
.current-indicator{font-size:13px;font-weight:600;color:var(--pri);white-space:nowrap}

.big-btn{display:block;width:100%;padding:12px;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;text-align:center;transition:all .15s;margin:5px 0}
.big-btn:active{transform:scale(.98)}
.btn-submit{background:var(--pri);color:#fff}
.btn-view{background:var(--warn);color:#fff}
.btn-retry{background:var(--ok);color:#fff}

.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:none;align-items:center;justify-content:center}
.modal-overlay.show{display:flex}
.modal{background:var(--card);border-radius:14px;padding:22px;max-width:520px;width:94%;max-height:82vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,.2)}
.modal h3{font-size:17px;margin-bottom:10px}
.modal-close{float:right;background:none;border:none;font-size:20px;cursor:pointer;color:var(--t2)}
.modal table{width:100%;border-collapse:collapse;font-size:13px}
.modal td,.modal th{padding:7px 8px;text-align:left;border-bottom:1px solid var(--brd)}
.modal th{color:var(--t2);font-weight:600}

@media(max-width:500px){
  body{padding:6px}
  .topbar h1{font-size:16px;max-width:180px}
  .card{padding:14px 10px}
  .q-text{font-size:14px}
  .opt{font-size:13px;padding:7px 10px}
  .nav-btn{padding:6px 12px;font-size:13px}
  .qgrid-item{width:26px;height:26px;font-size:10px}
  .mode-tab{font-size:11px;padding:6px 7px}
}
</style>
</head>
<body>
<div class="container">
<div class="topbar">
  <h1>📝 \${escHtml(courseName)}</h1>
  <span class="meta">\${total}题 · \${withAns}有答案</span>
</div>

<div class="mode-tabs">
  <button class="mode-tab active" data-mode="practice">📖 练习</button>
  <button class="mode-tab" data-mode="exam">📝 考试</button>
  <button class="mode-tab" data-mode="flashcard">🃏 闪卡</button>
  <button class="mode-tab" id="btnWrongBook">📕 错题<span id="wrongCount"></span></button>
  <button class="mode-tab" id="btnFavorites">⭐ 收藏<span id="favCount"></span></button>
  <button class="mode-tab" id="btnScores">📊 成绩</button>
</div>

<div class="subbar">
  <select id="sectionFilter"><option value="all">📂 全部章节</option></select>
  <input type="text" id="searchInput" placeholder="🔍 搜索题目/选项...">
  <button id="btnRandom" class="btn-sm btn-out">🔀 随机</button>
  <button id="btnToggleDark" class="btn-sm btn-out">🌓</button>
  <button id="btnReset" class="btn-sm btn-out">🔄</button>
  <button id="btnClearWrong" class="btn-sm btn-err" style="display:none">🗑错题</button>
  <span class="timer" id="examTimer" style="display:none"></span>
</div>

<div class="progress-wrap">
  <div class="progress-bar"><div class="progress-fill" id="progFill" style="width:0%"></div></div>
  <div class="progress-info"><span id="progLabel">第 1 / \${total} 题</span><span id="ansCount">已答: 0</span></div>
</div>

<div class="qgrid" id="qGrid"></div>
<div class="card" id="qCard"></div>
<div id="actionArea" style="margin-bottom:10px"></div>

<div class="nav-row">
  <button class="nav-btn" id="btnPrev">← 上一题</button>
  <span class="current-indicator" id="curIndicator"></span>
  <button class="nav-btn" id="btnNext">下一题 →</button>
</div>
</div>

<div class="modal-overlay" id="wrongBookModal"><div class="modal"><button class="modal-close" id="closeWrongBook">&times;</button><h3>📕 错题本</h3><div id="wrongBookContent"></div></div></div>
<div class="modal-overlay" id="scoresModal"><div class="modal"><button class="modal-close" id="closeScores">&times;</button><h3>📊 考试成绩记录</h3><div id="scoresContent"></div></div></div>
<div class="modal-overlay" id="favModal"><div class="modal"><button class="modal-close" id="closeFav">&times;</button><h3>⭐ 收藏夹</h3><div id="favContent"></div></div></div>

<script>
var QUESTIONS = \${questionsJSON};
var SECTIONS = \${sectionsJSON};
var TOTAL = \${total};
var LABELS = '\${labelsStr}';

var mode='practice', currentIdx=0, userAnswers={}, revealed={}, submitted=false;
var filteredQuestions=[], wrongBook=[], favorites=[], scoreHistory=[];
var examTimer=null, examSeconds=0, examTimeLimit=0;

var LS_WRONG='cxr_wb4', LS_SCORES='cxr_sc4', LS_ANSWERS='cxr_ma4', LS_DARK='cxr_d4', LS_FAV='cxr_fav4';

// ===== 工具函数 =====
var _escH=function(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');};
var sameSet=function(a,b){if(!a||!b)return false;a=a.slice().sort();b=b.slice().sort();return a.length===b.length&&a.every(function(v,i){return v===b[i];});};

// 多选题：将 "ABC" 转为索引数组 [0,1,2]
function getAnsIndices(q){
  if(!q.answer)return[-1];
  var ans=q.answer.trim();
  if(/^[A-H]{2,}$/i.test(ans)&&!/[、,，]/.test(ans)){
    return ans.split('').map(function(c){return LABELS.indexOf(c.toUpperCase());}).filter(function(i){return i>=0&&i<q.options.length;});
  }
  // 单选题：找单个匹配
  for(var i=0;i<q.options.length;i++){
    var o=q.options[i];
    if(o.label===ans||o.label.charAt(0)===ans||o.text===ans) return [i];
  }
  var idx=LABELS.indexOf(ans.charAt(0).toUpperCase());
  return idx>=0&&idx<q.options.length?[idx]:[-1];
}

function formatAnswer(q){
  if(!q.answer)return'(未知)';
  var idxs=getAnsIndices(q);
  if(idxs.length>0&&idxs[0]>=0) return idxs.map(function(i){var o=q.options[i];return(o?(o.label||LABELS.charAt(i)):'')+'. '+(o?o.text:'');}).join(' / ');
  return q.answer;
}

function checkAnswer(q, sel){
  if(!q.hasAnswer)return null;
  if(q.type==='多选题'){
    return sameSet(sel||[], getAnsIndices(q));
  }
  var ansI=getAnsIndices(q)[0];
  if(typeof sel==='number')return sel===ansI;
  return String(sel).trim()===q.answer.trim();
}

// ===== 初始化 =====
function init(){
  try{
    wrongBook=JSON.parse(localStorage.getItem(LS_WRONG)||'[]');
    scoreHistory=JSON.parse(localStorage.getItem(LS_SCORES)||'[]');
    favorites=JSON.parse(localStorage.getItem(LS_FAV)||'[]');
    var sa=JSON.parse(localStorage.getItem(LS_ANSWERS)||'{}');
    QUESTIONS.forEach(function(q){if(!q.hasAnswer&&sa[q.id]){q.answer=sa[q.id];q.hasAnswer=true;}});
  }catch(e){}
  if((localStorage.getItem(LS_DARK)||'0')==='1')document.documentElement.classList.add('dark');
  var sf=document.getElementById('sectionFilter');
  SECTIONS.forEach(function(s,i){var o=document.createElement('option');o.value=i;o.textContent=s.title+' ('+s.questionIds.length+'题)';sf.appendChild(o);});
  applyFilter();renderAll();
}

function applyFilter(){
  var val=document.getElementById('sectionFilter').value;
  var search=document.getElementById('searchInput').value.trim().toLowerCase();
  var pool=val==='all'?QUESTIONS.slice():QUESTIONS.filter(function(q){return SECTIONS[parseInt(val)].questionIds.indexOf(q.id)>=0;});
  if(search){
    pool=pool.filter(function(q){
      if(q.text.toLowerCase().indexOf(search)>=0)return true;
      if(q.knowledge&&q.knowledge.toLowerCase().indexOf(search)>=0)return true;
      if(q.options&&q.options.some(function(o){return o.text.toLowerCase().indexOf(search)>=0;}))return true;
      return false;
    });
  }
  filteredQuestions=pool;
  currentIdx=Math.min(currentIdx,filteredQuestions.length-1);
  if(currentIdx<0)currentIdx=0;
  renderAll();
}

// ===== 闪卡模式辅助 =====
function getFlashAnswer(q){
  var ans=formatAnswer(q);
  var extra='';
  if(q.knowledge)extra='<div style="font-size:13px;opacity:.8">💡 '+_escH(q.knowledge)+'</div>';
  return '<div style="font-weight:700;font-size:18px">'+_escH(ans)+'</div>'+extra;
}

// ===== 渲染 =====
function renderAll(){
  renderQGrid();renderCard();renderAction();renderNav();updateProgress();updateCounts();
}

function getQ(){return filteredQuestions[currentIdx]||{id:0,type:'',text:'无题目',options:[],answer:'',hasAnswer:false};}

function renderQGrid(){
  var g=document.getElementById('qGrid'),h='';
  filteredQuestions.forEach(function(q,i){
    var c='qgrid-item';
    if(i===currentIdx)c+=' current';
    var a=userAnswers[q.id];
    if(a!==undefined&&a!==null&&a!==''&&(!Array.isArray(a)||a.length>0))c+=' answered';
    if(wrongBook.indexOf(q.id)>=0)c+=' wrong-mark';
    if(favorites.indexOf(q.id)>=0)c+=' fav-mark';
    h+='<div class="'+c+'" data-idx="'+i+'">'+(i+1)+'</div>';
  });
  g.innerHTML=h;
  g.querySelectorAll('.qgrid-item').forEach(function(el){el.addEventListener('click',function(){currentIdx=parseInt(this.dataset.idx);renderAll();});});
}

function renderCard(){
  var q=getQ();
  if(!q||!q.id){document.getElementById('qCard').innerHTML='<p style="text-align:center;color:var(--t2);padding:40px">没有题目</p>';return;}
  var sel=userAnswers[q.id];
  var showRes=(mode==='practice'&&revealed[q.id]);
  var showExam=(mode==='exam'&&submitted);
  var isMulti=q.type==='多选题';
  var isFill=q.type==='填空题';
  var isJudge=q.type==='判断题';
  var done=showRes||showExam;

  // 闪卡模式特殊渲染
  if(mode==='flashcard'){
    var flipped=revealed[q.id];
    var h='<div class="star-btn'+(favorites.indexOf(q.id)>=0?' active':'')+'" id="starBtn">★</div>';
    h+='<div class="flashcard-flip'+(flipped?' flipped':'')+'" id="flashCard"><div class="inner">';
    h+='<div class="flash-front"><div><span class="q-type" style="margin-right:6px">'+_escH(q.type)+'</span>'+(q.hasAnswer?'':' <span class="no-ans-tag">无答案</span>')+'<br><br>'+_escH(q.text)+'</div></div>';
    h+='<div class="flash-back">'+getFlashAnswer(q)+'</div>';
    h+='</div></div>';
    document.getElementById('qCard').innerHTML=h;
    var fc=document.getElementById('flashCard');
    if(fc)fc.addEventListener('click',function(){flipped=!flipped;revealed[q.id]=flipped;renderAll();});
    var sb=document.getElementById('starBtn');
    if(sb)sb.addEventListener('click',function(e){e.stopPropagation();toggleFav(q.id);});
    return;
  }

  var h='<div class="star-btn'+(favorites.indexOf(q.id)>=0?' active':'')+'" id="starBtn">★</div>';
  h+='<div class="q-head"><span class="q-num">'+(currentIdx+1)+'</span><span class="q-type">'+_escH(q.type)+'</span>';
  h+='<span class="q-text">'+_escH(q.text)+(q.hasAnswer?'':' <span class="no-ans-tag">答案待补充</span>')+'</span></div>';

  if(q.options&&q.options.length>0){
    h+='<div class="options">';
    q.options.forEach(function(opt,oi){
      var c='opt';
      if(isMulti){c+=' multi';}
      if(done){c+=' done';
        var idxs=getAnsIndices(q);
        if(itemIn(idxs,oi))c+=' correct';
        else if(itemIn(sel,oi))c+=' wrong';
      } else if(isMulti){
        if(itemIn(sel,oi))c+=' selected';
      } else {
        if(sel===oi)c+=' selected';
      }
      h+='<div class="'+c+'" data-oi="'+oi+'">';
      if(isMulti){h+='<span class="o-check">✓</span>';}
      else {h+='<span class="o-label">'+_escH(opt.label||LABELS.charAt(oi))+'.</span>';}
      h+='<span>'+_escH(opt.text)+'</span></div>';
    });
    h+='</div>';
    // 多选题确认按钮
    if(isMulti&&!done){
      var hasMultiSel=Array.isArray(sel)&&sel.length>0;
      h+='<div class="confirm-row"><button class="btn-pri" id="btnConfirmMulti" '+(hasMultiSel?'':'disabled')+'>✅ 确认选择</button></div>';
    }
  } else if(isFill){
    var bc=q.blankCount||1;
    h+='<div class="fill-row">';
    for(var bi=0;bi<bc;bi++){
      var fsel=Array.isArray(sel)?(sel[bi]||''):(bi===0?String(sel||''):'');
      h+='<input type="text" class="fill-input fill-ans" data-bi="'+bi+'" placeholder="填空'+(bc>1?(' '+(bi+1)):'')+'" value="'+_escH(String(fsel))+'"'+(done?' disabled':'')+'>';
    }
    h+='</div>';
  }

  // 结果
  if(showRes||showExam){
    var cr=checkAnswer(q,sel);
    if(cr===null){
      h+='<div class="result show info"><strong>⚠️ 暂无标准答案</strong></div>';
    }else{
      h+='<div class="result show '+(cr?'ok':'err')+'"><strong>'+(cr?'✅ 正确!':'❌ 错误')+'</strong>';
      h+='<div style="margin-top:4px;font-size:13px">正确答案: <b>'+_escH(formatAnswer(q))+'</b></div>';
      if(q.knowledge)h+='<div style="font-size:12px;opacity:.8">💡 '+_escH(q.knowledge)+'</div>';
      h+='</div>';
    }
  }

  document.getElementById('qCard').innerHTML=h;

  if(!done){
    document.querySelectorAll('.opt:not(.done)').forEach(function(el){
      el.addEventListener('click',function(){handleSelect(parseInt(this.dataset.oi));});
    });
    document.querySelectorAll('.fill-ans').forEach(function(el){
      el.addEventListener('input',function(){handleFill(parseInt(this.dataset.bi),this.value);});
    });
    var cm=document.getElementById('btnConfirmMulti');
    if(cm)cm.addEventListener('click',function(){handleMultiConfirm();});
  }
  var sb2=document.getElementById('starBtn');
  if(sb2)sb2.addEventListener('click',function(){toggleFav(q.id);});
}

function itemIn(arr,val){return Array.isArray(arr)?arr.indexOf(val)>=0:arr===val;}

function handleSelect(oi){
  var q=getQ();
  if(q.type==='多选题'){
    var cur=userAnswers[q.id];
    if(!Array.isArray(cur))cur=cur!==undefined?[cur]:[];
    var idx=cur.indexOf(oi);
    if(idx>=0)cur.splice(idx,1);else cur.push(oi);
    userAnswers[q.id]=cur.length>0?cur:null;
  } else {
    userAnswers[q.id]=oi;
    // 单选题在练习模式立即显示答案
    if(mode==='practice'){
      revealed[q.id]=true;
      handleWrongBook(q);
    }
  }
  renderAll();
}

function handleFill(bi,val){
  var q=getQ();
  var arr=userAnswers[q.id];
  if(!Array.isArray(arr))arr=[];
  arr[bi]=val;
  userAnswers[q.id]=arr;
  renderQGrid();updateProgress();
}

function handleMultiConfirm(){
  var q=getQ();
  if(mode==='practice'){
    revealed[q.id]=true;
    handleWrongBook(q);
  }
  renderAll();
}

function handleWrongBook(q){
  var cr=checkAnswer(q,userAnswers[q.id]);
  if(cr===false&&wrongBook.indexOf(q.id)<0){wrongBook.push(q.id);saveWrongBook();}
  if(cr===true&&wrongBook.indexOf(q.id)>=0){wrongBook=wrongBook.filter(function(x){return x!==q.id;});saveWrongBook();}
}

function toggleFav(qid){
  var idx=favorites.indexOf(qid);
  if(idx>=0)favorites.splice(idx,1);else favorites.push(qid);
  try{localStorage.setItem(LS_FAV,JSON.stringify(favorites));}catch(e){}
  updateCounts();renderAll();
}

function renderAction(){
  var a=document.getElementById('actionArea'),q=getQ();
  if(!q||!q.id){a.innerHTML='';return;}
  if(mode==='flashcard'){a.innerHTML='<div style="text-align:center;font-size:13px;color:var(--t2);padding:6px">👆 点击卡片翻转查看答案</div>';return;}
  var done=revealed[q.id]||submitted;
  var answered=q.type==='多选题'?(Array.isArray(userAnswers[q.id])&&userAnswers[q.id].length>0):
    (userAnswers[q.id]!==undefined&&userAnswers[q.id]!==null&&userAnswers[q.id]!=='');
  if(mode==='practice'){
    if(!done&&answered&&q.type!=='多选题')a.innerHTML='<button class="big-btn btn-view" id="btnReveal">💡 查看答案</button>';
    else if(!done)a.innerHTML='<div style="text-align:center;font-size:13px;color:var(--t2);padding:6px">'+(q.type==='多选题'?'勾选后点击「确认选择」':'点击选项查看答案')+'</div>';
    else a.innerHTML='';
  } else if(mode==='exam'){
    if(!submitted){
      var allDone=filteredQuestions.every(function(qq){
        var av=userAnswers[qq.id];
        if(qq.type==='多选题')return Array.isArray(av)&&av.length>0;
        return av!==undefined&&av!==null&&av!=='';
      });
      a.innerHTML='<button class="big-btn btn-submit" id="btnSubmitExam"'+(allDone?'':'disabled')+'>📋 提交试卷</button>';
      if(!allDone)a.innerHTML+='<div style="text-align:center;font-size:12px;color:var(--t2);margin-top:3px">答完所有题目后才能提交</div>';
    } else {a.innerHTML='<button class="big-btn btn-retry" id="btnRetryExam">🔄 重新考试</button>';}
  }
  var rb=document.getElementById('btnReveal');if(rb)rb.addEventListener('click',function(){revealed[getQ().id]=true;handleWrongBook(getQ());renderAll();});
  var sb=document.getElementById('btnSubmitExam');if(sb&&!submitted)sb.addEventListener('click',submitExam);
  var rt=document.getElementById('btnRetryExam');if(rt)rt.addEventListener('click',retryExam);
}

function renderNav(){
  document.getElementById('btnPrev').disabled=currentIdx<=0;
  document.getElementById('btnNext').disabled=currentIdx>=filteredQuestions.length-1;
  document.getElementById('curIndicator').textContent=(currentIdx+1)+' / '+filteredQuestions.length;
}

function updateProgress(){
  var ans=0;
  filteredQuestions.forEach(function(q){
    var a=userAnswers[q.id];
    if(q.type==='多选题'){if(Array.isArray(a)&&a.length>0)ans++;}
    else if(a!==undefined&&a!==null&&a!=='')ans++;
  });
  document.getElementById('progFill').style.width=filteredQuestions.length>0?(ans/filteredQuestions.length*100)+'%':'0%';
  document.getElementById('progLabel').textContent='第 '+(currentIdx+1)+' / '+filteredQuestions.length+' 题';
  document.getElementById('ansCount').textContent='已答: '+ans;
}

function updateCounts(){
  document.getElementById('wrongCount').textContent=wrongBook.length>0?' ('+wrongBook.length+')':'';
  document.getElementById('favCount').textContent=favorites.length>0?' ('+favorites.length+')':'';
  document.getElementById('btnClearWrong').style.display=wrongBook.length>0?'':'none';
}

function saveWrongBook(){try{localStorage.setItem(LS_WRONG,JSON.stringify(wrongBook));}catch(e){}updateCounts();renderQGrid();}

// ===== 考试模式 =====
function submitExam(){
  submitted=true;
  clearInterval(examTimer);
  filteredQuestions.forEach(function(q){
    var cr=checkAnswer(q,userAnswers[q.id]);
    if(q.hasAnswer&&cr===false&&wrongBook.indexOf(q.id)<0)wrongBook.push(q.id);
  });
  saveWrongBook();
  var correct=0,totalAns=0;
  filteredQuestions.forEach(function(q){
    if(!q.hasAnswer)return;
    totalAns++;
    if(checkAnswer(q,userAnswers[q.id]))correct++;
  });
  var score=totalAns>0?Math.round(correct/totalAns*100):0;
  scoreHistory.push({date:new Date().toISOString(),score:score,correct:correct,totalQ:totalAns,totalAll:filteredQuestions.length,section:document.getElementById('sectionFilter').selectedOptions[0].textContent,mode:'exam',time:examSeconds});
  try{localStorage.setItem(LS_SCORES,JSON.stringify(scoreHistory));}catch(e){}
  renderAll();
  showScorePopup(score,correct,totalAns);
}

function retryExam(){submitted=false;userAnswers={};revealed={};examSeconds=0;renderAll();}
function showScorePopup(score,correct,totalAns){
  var ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  ov.innerHTML='<div style="background:var(--card);border-radius:16px;padding:30px;text-align:center;max-width:360px;width:90%;box-shadow:0 12px 48px rgba(0,0,0,.3)"><div style="font-size:48px;margin-bottom:8px">'+(score>=60?'🎉':'😢')+'</div><div style="font-size:36px;font-weight:800;color:'+(score>=60?'var(--ok)':'var(--err)')+'">'+score+'分</div><div style="font-size:14px;color:var(--t2);margin:8px 0">答对 '+correct+'/'+totalAns+' 题'+(examSeconds>0?' | 用时 '+formatTime(examSeconds):'')+'</div><button style="margin-top:16px;padding:10px 32px;border:none;border-radius:8px;background:var(--pri);color:#fff;font-size:15px;font-weight:600;cursor:pointer">确定</button></div>';
  document.body.appendChild(ov);
  ov.querySelector('button').addEventListener('click',function(){ov.remove();});
  ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});
}
function formatTime(s){var m=Math.floor(s/60),sec=s%60;return (m>0?m+'分':'')+sec+'秒';}

// ===== 弹窗 =====
function showWrongBook(){
  var m=document.getElementById('wrongBookModal'),c=document.getElementById('wrongBookContent');
  if(wrongBook.length===0){c.innerHTML='<p style="color:var(--t2);text-align:center;padding:20px">🎉 错题本为空!</p>';m.classList.add('show');return;}
  var h='<p style="margin-bottom:8px;color:var(--t2)">共 <b>'+wrongBook.length+'</b> 条</p><button class="btn-sm btn-pri" id="btnPracticeWrong" style="margin-bottom:8px">📖 练错题</button> <button class="btn-sm btn-out" id="btnExamWrong" style="margin-bottom:8px">📝 错题考试</button>';
  wrongBook.forEach(function(qid){
    var q=QUESTIONS.find(function(x){return x.id===qid;});if(!q)return;
    h+='<div style="padding:10px;margin:4px 0;background:var(--bg);border-radius:8px;font-size:13px"><b>#'+q.id+'</b> ['+_escH(q.type)+'] '+_escH(q.text)+'<div style="color:var(--ok);margin-top:3px">答案: '+_escH(formatAnswer(q))+'</div><button class="btn-sm btn-err rem-wb" data-qid="'+q.id+'" style="margin-top:3px;font-size:11px">移除</button></div>';
  });
  c.innerHTML=h;
  m.classList.add('show');
  c.querySelectorAll('.rem-wb').forEach(function(b){b.addEventListener('click',function(){wrongBook=wrongBook.filter(function(x){return x!==parseInt(this.dataset.qid);});saveWrongBook();showWrongBook();});});
  document.getElementById('btnPracticeWrong').addEventListener('click',function(){m.classList.remove('show');filteredQuestions=QUESTIONS.filter(function(q){return wrongBook.indexOf(q.id)>=0;});currentIdx=0;userAnswers={};revealed={};submitted=false;setMode('practice');});
  document.getElementById('btnExamWrong').addEventListener('click',function(){m.classList.remove('show');filteredQuestions=QUESTIONS.filter(function(q){return wrongBook.indexOf(q.id)>=0;});currentIdx=0;userAnswers={};revealed={};submitted=false;setMode('exam');});
}

function showScores(){
  var m=document.getElementById('scoresModal'),c=document.getElementById('scoresContent');
  if(scoreHistory.length===0){c.innerHTML='<p style="color:var(--t2);text-align:center;padding:20px">暂无记录</p>';}
  else {
    var h='<table><thead><tr><th>时间</th><th>章节</th><th>得分</th><th>操</th></tr></thead><tbody>';
    scoreHistory.slice().reverse().forEach(function(r,i){
      var d=new Date(r.date),ds=d.getFullYear()+'-'+s2(d.getMonth()+1)+'-'+s2(d.getDate())+' '+s2(d.getHours())+':'+s2(d.getMinutes());
      h+='<tr><td>'+ds+'</td><td>'+_escH(r.section||'-')+'</td><td style="font-weight:700;color:'+(r.score>=60?'var(--ok)':'var(--err)')+'">'+r.score+'分 ('+r.correct+'/'+r.totalQ+')'+(r.time?' '+formatTime(r.time):'')+'</td><td><button class="btn-sm btn-err del-sc" data-idx="'+(scoreHistory.length-1-i)+'" style="font-size:11px">✕</button></td></tr>';
    });
    h+='</tbody></table><button class="btn-sm btn-err" id="btnClearScores" style="margin-top:8px">🗑 清空</button>';
    c.innerHTML=h;
  }
  m.classList.add('show');
  c.querySelectorAll('.del-sc').forEach(function(b){b.addEventListener('click',function(){scoreHistory.splice(parseInt(this.dataset.idx),1);try{localStorage.setItem(LS_SCORES,JSON.stringify(scoreHistory));}catch(e){}showScores();});});
  var cb=document.getElementById('btnClearScores');if(cb)cb.addEventListener('click',function(){if(confirm('清空所有成绩？')){scoreHistory=[];try{localStorage.setItem(LS_SCORES,'[]');}catch(e){}showScores();}});
}

function showFavorites(){
  var m=document.getElementById('favModal'),c=document.getElementById('favContent');
  if(favorites.length===0){c.innerHTML='<p style="color:var(--t2);text-align:center;padding:20px">⭐ 还没有收藏</p>';m.classList.add('show');return;}
  var h='<p style="margin-bottom:8px;color:var(--t2)">共 <b>'+favorites.length+'</b> 题</p><button class="btn-sm btn-pri" id="btnFavPractice" style="margin-bottom:8px">📖 练收藏</button> <button class="btn-sm btn-out" id="btnFavExam" style="margin-bottom:8px">📝 收藏考试</button>';
  favorites.forEach(function(qid){
    var q=QUESTIONS.find(function(x){return x.id===qid;});if(!q)return;
    h+='<div style="padding:8px;margin:4px 0;background:var(--bg);border-radius:8px;font-size:13px"><b>#'+q.id+'</b> ['+_escH(q.type)+'] '+_escH(q.text).substring(0,80)+'<button class="btn-sm btn-err rem-fav" data-qid="'+q.id+'" style="margin-left:8px;font-size:11px">✕</button></div>';
  });
  c.innerHTML=h;
  m.classList.add('show');
  c.querySelectorAll('.rem-fav').forEach(function(b){b.addEventListener('click',function(){toggleFav(parseInt(this.dataset.qid));showFavorites();});});
  document.getElementById('btnFavPractice').addEventListener('click',function(){m.classList.remove('show');filteredQuestions=QUESTIONS.filter(function(q){return favorites.indexOf(q.id)>=0;});currentIdx=0;userAnswers={};revealed={};submitted=false;setMode('practice');});
  document.getElementById('btnFavExam').addEventListener('click',function(){m.classList.remove('show');filteredQuestions=QUESTIONS.filter(function(q){return favorites.indexOf(q.id)>=0;});currentIdx=0;userAnswers={};revealed={};submitted=false;setMode('exam');});
}

function s2(n){return String(n).padStart(2,'0');}

// ===== 模式切换 =====
function setMode(m){
  mode=m;
  document.querySelectorAll('.mode-tab[data-mode]').forEach(function(t){t.classList.toggle('active',t.dataset.mode===m);});
  if(m==='practice'){submitted=false;}
  else if(m==='exam'){revealed={};submitted=false;}
  else if(m==='flashcard'){revealed={};submitted=false;}
  document.getElementById('examTimer').style.display=m==='exam'?'':'none';
  renderAll();
}

// ===== 事件 =====
document.querySelectorAll('.mode-tab[data-mode]').forEach(function(t){t.addEventListener('click',function(){setMode(this.dataset.mode);});});
document.getElementById('btnWrongBook').addEventListener('click',showWrongBook);
document.getElementById('btnScores').addEventListener('click',showScores);
document.getElementById('btnFavorites').addEventListener('click',showFavorites);
document.getElementById('sectionFilter').addEventListener('change',function(){currentIdx=0;userAnswers={};revealed={};submitted=false;applyFilter();});
document.getElementById('searchInput').addEventListener('input',function(){currentIdx=0;applyFilter();});
document.getElementById('btnRandom').addEventListener('click',function(){
  for(var i=filteredQuestions.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=filteredQuestions[i];filteredQuestions[i]=filteredQuestions[j];filteredQuestions[j]=t;}
  currentIdx=0;userAnswers={};revealed={};submitted=false;renderAll();
});
document.getElementById('btnPrev').addEventListener('click',function(){if(currentIdx>0){currentIdx--;renderAll();}});
document.getElementById('btnNext').addEventListener('click',function(){if(currentIdx<filteredQuestions.length-1){currentIdx++;renderAll();}});
document.getElementById('btnToggleDark').addEventListener('click',function(){document.documentElement.classList.toggle('dark');try{localStorage.setItem(LS_DARK,document.documentElement.classList.contains('dark')?'1':'0');}catch(e){}});
document.getElementById('btnReset').addEventListener('click',function(){userAnswers={};revealed={};submitted=false;renderAll();});
document.getElementById('btnClearWrong').addEventListener('click',function(){if(confirm('清空错题本？')){wrongBook=[];saveWrongBook();}});
document.getElementById('closeWrongBook').addEventListener('click',function(){document.getElementById('wrongBookModal').classList.remove('show');});
document.getElementById('closeScores').addEventListener('click',function(){document.getElementById('scoresModal').classList.remove('show');});
document.getElementById('closeFav').addEventListener('click',function(){document.getElementById('favModal').classList.remove('show');});
document.querySelectorAll('.modal-overlay').forEach(function(ov){ov.addEventListener('click',function(e){if(e.target===ov)ov.classList.remove('show');});});
document.addEventListener('keydown',function(e){
  if(document.querySelector('.modal-overlay.show'))return;
  if(e.key==='ArrowLeft'){if(currentIdx>0){currentIdx--;renderAll();}}
  if(e.key==='ArrowRight'){if(currentIdx<filteredQuestions.length-1){currentIdx++;renderAll();}}
});
init();
</script>
</body>
</html>`;
  }

  function downloadHTML() {
    if (totalQuestions === 0) {
      alert('没有题目可导出，请先抓取数据');
      return;
    }

    const html = generatePracticeHTML();
    if (!html) return;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (courseName || '练习').replace(/[\\/:*?"<>|]/g, '_').substring(0, 40);
    a.href = url;
    a.download = safeName + '_全部题目_' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('✅ HTML 文件已下载!');
  }

  // ===================== 初始化 =====================
  function init() {
    // 等待页面加载完成
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    // 注入 UI
    injectUI();
    log('✅ 超星测验提取器已就绪');
    updateInfo();
  }

  init();
})();

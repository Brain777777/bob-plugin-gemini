//@ts-check

var lang = require("./lang.js");
var SYSTEM_PROMPT = require("./constant.js").SYSTEM_PROMPT;

var {
    ensureHttpsAndNoTrailingSlash,
    getApiKey,
    handleGeneralError,
} = require("./utils.js");


/**
 * @param {Bob.TranslateQuery} query
 * @returns {{ 
 *  generatedSystemPrompt: string 
 *  generatedUserPrompt: string 
 * }}
*/
function generatePrompts(query) {
    let generatedSystemPrompt = SYSTEM_PROMPT;
    const { detectFrom, detectTo } = query;
    const sourceLang = lang.langMap.get(detectFrom) || detectFrom;
    const targetLang = lang.langMap.get(detectTo) || detectTo;
    let generatedUserPrompt = `translate from ${sourceLang} to ${targetLang}`;

    if (detectTo === "wyw" || detectTo === "yue") {
        generatedUserPrompt = `翻译成${targetLang}`;
    }

    if (
        detectFrom === "wyw" ||
        detectFrom === "zh-Hans" ||
        detectFrom === "zh-Hant"
    ) {
        if (detectTo === "zh-Hant") {
            generatedUserPrompt = "翻译成繁体白话文";
        } else if (detectTo === "zh-Hans") {
            generatedUserPrompt = "翻译成简体白话文";
        } else if (detectTo === "yue") {
            generatedUserPrompt = "翻译成粤语白话文";
        }
    }

    if (detectFrom === detectTo) {
        generatedSystemPrompt =
            "You are a text embellisher, you can only embellish the text, don't interpret it.";
        if (detectTo === "zh-Hant" || detectTo === "zh-Hans") {
            generatedUserPrompt = "润色此句";
        } else {
            generatedUserPrompt = "polish this sentence";
        }
    }


    generatedUserPrompt = `${generatedUserPrompt}:\n\n${query.text}`

    return { generatedSystemPrompt,generatedUserPrompt };
}

/**
 * 
 * @param {Bob.TranslateQuery} query
 * @returns Record
*/
function buildRequestBody (query) {
    const { generatedUserPrompt ,generatedSystemPrompt} = generatePrompts(query);
    return {
      contents: [
          {
            role: "user",
            parts: [
              {
                text: generatedSystemPrompt
              }
            ]
          },
          {
            role: "model",
            parts: [
              {
                text: generatedSystemPrompt.replace('You are ','Im ')
              }
            ]
          },
          {
            role: "user",
            parts: [
              {
                text: generatedUserPrompt
              }
            ]
          },
        ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
        topP: 1
      }
    };
}


/**
 * @param {Bob.TranslateQuery} query
 * @param {Bob.Completion} completion
 * @param {Bob.HttpResponse} result
 * @returns {void}
*/
function handleGeneralResponse( query,completion, result) {
    const { candidates } = result.data;

    if (!candidates || candidates.length === 0) {
        handleGeneralError(query, completion,{
            type: "api",
            message: "接口未返回结果",
            addition: JSON.stringify(result),
        });
        return;
    }

    let targetText = candidates[0].content.parts[0].text.trim();
    $log.info(targetText);
    // 使用正则表达式删除字符串开头和结尾的特殊字符
    targetText = targetText.replace(/^(『|「|"|“)|(』|」|"|”)$/g, "");
     
    // 判断并删除字符串末尾的 `" =>`
    if (targetText.endsWith('" =>')) {
        targetText = targetText.slice(0, -4);
    }

    completion({
        result: {
            from: query.detectFrom,
            to: query.detectTo,
            toParagraphs: targetText.split("\n"),
        },
    });
}

/**
 * @type {Bob.Translate}
 */
function translate(query,completion) {
    if (!lang.langMap.get(query.detectTo)) {
        handleGeneralError(query, completion,{
            type: "unsupportLanguage",
            message: "不支持该语种",
            addition: "不支持该语种",
        });
    }
    const { 
        apiKeys, 
        apiUrl
    } = $option;

    if (!apiKeys) {
        handleGeneralError(query,completion, {
            type: "secretKey",
            message: "配置错误 - 请确保您在插件配置中填入了正确的 API Keys",
            addition: "请在插件配置中填写 API Keys",
        });
    }

    const apiKey = getApiKey($option.apiKeys);
    const baseUrl = ensureHttpsAndNoTrailingSlash(apiUrl || "https://generativelanguage.googleapis.com");
    let apiUrlPath =  "/v1beta/models/gemini-pro:generateContent?key=" + apiKey;
    const body = buildRequestBody(query);
    (async () => {
      const result = await $http.request({
          method: "POST",
          url: baseUrl + apiUrlPath,
          header:{
            "Content-Type": "application/json",
          },
          body,
      });
      if (result.error) {
          handleGeneralError(query, completion,result);
      } else {
          handleGeneralResponse(query, completion,result);
      }
    })().catch((err) => {
        handleGeneralError(query,completion, err);
    });
}

function supportLanguages() {
    return lang.supportLanguages.map(([standardLang]) => standardLang);
}

function pluginTimeoutInterval() {
    // @ts-ignore
    return 60;
}

exports.pluginTimeoutInterval = pluginTimeoutInterval;
exports.supportLanguages = supportLanguages;
exports.translate = translate;

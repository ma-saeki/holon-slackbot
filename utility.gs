function isCachedId(id) {
  const cache = CacheService.getScriptCache();
  const isCached = cache.get(id);
  if (isCached) {
    return true;
  }
  cache.put(id, true, 60 * 5);
  return false;
}

function shouldRespond(triggerMsg) {
  const botUserId = PropertiesService.getScriptProperties().getProperty('BOT_USER_ID');
  const botDmChannelId = PropertiesService.getScriptProperties().getProperty('BOT_DM_CHANNEL_ID');
  const isInThread = triggerMsg.thread_ts;
  const isMentionedBot = triggerMsg.text.includes(botUserId);

  if (!isInThread) {
    return triggerMsg.channel === botDmChannelId || isMentionedBot;
  } else {
    const isMentionedNonBot = !isMentionedBot && triggerMsg.text.includes("<@");
    if (isMentionedNonBot) {
      return false;
    } else {
      const msgsInThread = fetchMsgsInThread(triggerMsg.channel, triggerMsg.thread_ts);
      const isBotInvolvedThread = msgsInThread.some(msg => msg.user === botUserId);
      return isBotInvolvedThread || isMentionedBot;
    }
  }
}

function fetchMsgsInThread(channel, thread_ts) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN');
  const response = UrlFetchApp.fetch(`https://slack.com/api/conversations.replies?channel=${channel}&ts=${thread_ts}`, {
    method: 'get',
    headers: {
      Authorization: 'Bearer ' + token,
    },
  });

  const responseData = JSON.parse(response.getContentText());
  return responseData.messages;
}

function fetchAIAnswerText(triggerMsg) {
  const msgsAskedToBot = fetchSlackMsgsAskedToBot(triggerMsg);
  if (msgsAskedToBot.length === 0) {
    return "";
  }

  const msgsForChatGpt = parseSlackMsgsToChatGPTQueryMsgs(msgsAskedToBot);
  const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
  const apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_KEY');
  const developerMessage = getSystemMessage();
  const CGCMessage = getCGCMessage();
  const model = PropertiesService.getScriptProperties().getProperty('MODEL');
  const maxTokens = parseInt(PropertiesService.getScriptProperties().getProperty('MAX_TOKENS'));

  const requestBody = {
    model: model,
    messages: [
      { role: "developer", content: developerMessage },
      { role: "user", content: CGCMessage }, 
      { role: "assistant", content: "了解"},
       ...msgsForChatGpt
    ],
    max_completion_tokens: maxTokens
  };

  try {
    const res = UrlFetchApp.fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
      },
      contentType: "application/json",
      payload: JSON.stringify(requestBody),
    });

    const resCode = res.getResponseCode();
    const resContent = res.getContentText();
    if (resCode !== 200) {
      if (resCode === 429) return "Rate limit exceeded. Please try again later.";
      return `API request failed with status ${resCode}: ${resContent}`;
    }

    const resPayloadObj = JSON.parse(resContent);
    if (resPayloadObj.choices.length === 0) return "No response from AI.";

    const rawAnswerText = resPayloadObj.choices[0].message.content;
    const trimmedAnswerText = rawAnswerText.replace(/^\n+/, "");

    return trimmedAnswerText;
  } catch (error) {
    Logger.log(`API request failed: ${error.message}`);
    sendErrorLogToSlack(`Error: ${error.message}\nStack: ${error.stack}`);
    return `API request failed with error: ${error.message}`;
  }
}

function fetchSlackMsgsAskedToBot(triggerMsg) {
  const botUserId = PropertiesService.getScriptProperties().getProperty('BOT_USER_ID');
  const botDmChannelId = PropertiesService.getScriptProperties().getProperty('BOT_DM_CHANNEL_ID');
  const isInThread = triggerMsg.thread_ts;
  const isMentionedBot = triggerMsg.text.includes(botUserId);

  if (!isInThread) {
    if (triggerMsg.channel === botDmChannelId) {
      Logger.log("Direct message to bot outside of thread, responding.");
      return [triggerMsg];
    }

    if (isMentionedBot) {
      Logger.log("Message mentioning bot outside of thread, responding.");
      return [triggerMsg];
    } else {
      Logger.log("Message not mentioning bot outside of thread, ignoring.");
      return [];
    }
  } else {
    const isMentionedNonBot = !isMentionedBot && triggerMsg.text.includes("<@");
    if (isMentionedNonBot) {
      Logger.log("Message in thread mentioning non-bot user, ignoring.");
      return [];
    } else {
      const msgsInThread = fetchMsgsInThread(triggerMsg.channel, triggerMsg.thread_ts);
      const isBotInvolvedThread = msgsInThread.some(msg => msg.user === botUserId);
      if (!isBotInvolvedThread && !isMentionedBot) {
        Logger.log("Thread not involving bot, ignoring.");
        return [];
      } else {
        Logger.log("Thread involving bot, responding.");
        return msgsInThread;
      }
    }
  }
}

function parseSlackMsgsToChatGPTQueryMsgs(slackMsgs) {
  const botUserId = PropertiesService.getScriptProperties().getProperty('BOT_USER_ID');
  return slackMsgs.map(msg => {
    return {
      role: msg.user === botUserId ? "assistant" : "user",
      content: trimMentionText(msg.text),
    };
  });
}

function slackPostMessage(channelId, message, option) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN');
  const payload = {
    channel: channelId,
    text: message,
    ...option
  };
  UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
  });
}

function addReaction(channelId, ts, emoji) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN');
  const payload = {
    channel: channelId,
    name: emoji,
    timestamp: ts,
  };
  UrlFetchApp.fetch('https://slack.com/api/reactions.add', {
    method: 'post',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
  });
}

function removeReaction(channelId, ts, emoji) {
  const token = PropertiesService.getScriptProperties().getProperty('SLACK_TOKEN');
  const payload = {
    channel: channelId,
    name: emoji,
    timestamp: ts,
  };
  UrlFetchApp.fetch('https://slack.com/api/reactions.remove', {
    method: 'post',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
  });
}

function trimMentionText(source) {
  const regex = /^<.+> /;
  return source.replace(regex, "").trim();
}

function sendErrorLogToSlack(errorLog) {
  const errorChannelId = PropertiesService.getScriptProperties().getProperty('ERROR_LOG_CHANNEL_ID');
  slackPostMessage(errorChannelId, errorLog);
}

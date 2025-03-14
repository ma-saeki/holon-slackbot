function doPost(e) {
  const reqObj = JSON.parse(e.postData.getDataAsString());
  // Event API Verification
  if (reqObj.type === "url_verification") {
    return ContentService.createTextOutput(reqObj.challenge);
  }
  // Log request
  Logger.log("Request from Slack:");
  Logger.log(reqObj);
  // Process event
  if (reqObj.type !== "event_callback" || reqObj.event.type !== "message") {
    Logger.log("No response needed. Not a message event.");
    return ContentService.createTextOutput('OK');
  }
  const triggerMsg = reqObj.event;
  const userId = triggerMsg.user;
  const msgId = triggerMsg.client_msg_id;
  const channelId = triggerMsg.channel;
  const ts = triggerMsg.ts;
  const botUserId = PropertiesService.getScriptProperties().getProperty('BOT_USER_ID');
  const ReactionName = PropertiesService.getScriptProperties().getProperty('REACTION_NAME');
  // Ignore bot's own messages
if (userId === botUserId) {
   Logger.log(`No response needed. Bot's own message: msgId=${msgId}`);
    return ContentService.createTextOutput('OK');
  }
  // Ignore duplicate requests
  if (isCachedId(msgId)) {
    Logger.log(`No response needed. Duplicate request: msgId=${msgId}`);
    return ContentService.createTextOutput('OK');
  }
  // Determine if the bot should respond
  if (!shouldRespond(triggerMsg)) {
    Logger.log("No response needed. Bot is not involved and not mentioned.");
    return ContentService.createTextOutput('OK');
  }
  // Add reaction to indicate processing
  addReaction(channelId, ts, ReactionName);
  try {
    let answerMsg;
    if (triggerMsg.files && triggerMsg.files.length > 0) {
      Logger.log("Files detected, but imagehandler.gs is removed. Skipping file processing.");
      answerMsg = "申し訳ありません。現在は画像ファイルの処理には対応していません。";
    } else {
      Logger.log("Text message detected. Processing text.");
      answerMsg = fetchAIAnswerText(triggerMsg);
    }
    if (!answerMsg) {
      Logger.log(`No response needed. Not a question to the bot: msgId=${msgId}`);
      removeReaction(channelId, ts, 'conga_parrot');
      return ContentService.createTextOutput('OK');
    }
    // Post response
    slackPostMessage(channelId, answerMsg, { thread_ts: ts });
    // Remove reaction after response
    removeReaction(channelId, ts, ReactionName);
    Logger.log(`[INFO] User ID: ${userId}, Response: ${answerMsg}`);
    Logger.log(`Response completed successfully: msgId=${msgId}`);
    return ContentService.createTextOutput('OK');
  } catch (error) {
    Logger.log(`Response failed: msgId=${msgId}`);
    Logger.log(error.stack);
    sendErrorLogToSlack(`Error: ${error.message}\nStack: ${error.stack}`);
    removeReaction(channelId, ts, ReactionName);
    return ContentService.createTextOutput('NG');
  }
}

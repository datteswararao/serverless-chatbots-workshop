var AWS = require('aws-sdk');
var lambda = new AWS.Lambda();
var db = new AWS.DynamoDB();
var http = require('https');
var async = require('async');
var path = require('path');
var page_id = process.env.FACEBOOK_PAGE_ID;
var page_access_token = process.env.FACEBOOK_ACCESS_TOKEN;

var esDomain = {
    region: process.env.AWS_REGION,
    endpoint: process.env.ES_ENDPOINT
};
var endpoint = new AWS.Endpoint(esDomain.endpoint);
var creds = new AWS.EnvironmentCredentials('AWS');

exports.handler = function(event, context) {
    if (event.Records) {
        async.eachLimit(event.Records, 5, function(record, callback) {
            var message;
            console.log(record);
            if (record.eventName === "INSERT" && record.dynamodb) {
                if (record.dynamodb.NewImage.message)
                    ProcessMessage(record.dynamodb.NewImage, event, context, callback);
            }
            if (record.eventName === "MODIFY" && record.dynamodb) {
                //items has been modified (check if we now have an approved or rejected answer and act accordingly)
                message = record.dynamodb.NewImage;
                if (message.answered && message.answered.S === "approved") {
                    // Answer has been approved, send it to the Facebook chat!
                    console.log("Facebook message approved");
                    console.log(message);
                    var answer = "No answer provided";
                    if (message.answer) answer = message.answer.S;
                    async.parallel([
                            function(callback) {
                                SendFacebookMessage(message.senderId.S, answer, "true", event, context, callback);
                            }
                        ],
                        function(err, results) {
                            if (err) callback(err);
                            console.log(results);
                            if (results[0].answered !== null)
                                MarkAsAnswered(message, results[0].answer, results[0].answered, event, context, callback);
                            else
                                callback(null);
                        });
                } else if (message.answered && message.answered.S === "rejected") {
                    console.log("Facebook message rejected");
                    async.parallel([
                            function(callback) {
                                SendFacebookMessage(message.senderId.S, "Unfortunately I did not understand your request. Could you rephrase your question?", "false", event, context, callback);
                            }
                        ],
                        function(err, results) {
                            if (err) callback(err);
                            console.log(results);
                            if (results[0].answered !== null)
                                MarkAsAnswered(message, results[0].answer, results[0].answered, event, context, callback);
                            else
                                callback(null);
                        });
                }
            }
        }, function(err) {
            if (err) {
                context.done(err);
            } else {
                context.done(null);
            }
        });
    }
};

var ProcessMessage = function(message, event, context, callback) {
    async.parallel([
            function(callback) {
                FindAnswer(message, event, context, callback);
            },
            function(callback) {
                AnalyzeSentiment(message.message.S, event, context, callback);
            }
        ],
        function(err, results) {
            if (err) callback(err);
            console.log(results);
            if (results[0].answered !== null)
                MarkAsAnswered(message, results[0].answer, results[0].answered, event, context, callback);
            else
                callback(null);
        });
};

var MarkAsAnswered = function(message, answer, state, event, context, callback) {
    console.log(message);
    var params = {
        TableName: 'facebook-messages',
        Key: {
            messageId: {
                S: message.messageId.S
            }
        },
        UpdateExpression: "SET answered = :state, answer = :answer",
        ExpressionAttributeValues: {
            ":state": {
                S: state
            },
            ":answer": {
                S: answer
            }
        },
        ReturnValues: "NONE"
    };
    db.updateItem(params, function(err, data) {
        if (err) callback(err);
        else callback(null);
    });
};

var SendFacebookMessage = function(recipient, message, answered, event, context, callback) {
    console.log("Sending message to Facebook:" + message);
    var response = JSON.stringify({
        "recipient": {
            "id": recipient
        },
        "message": {
            "text": message
        }
    });
    var post_options = {
        host: 'graph.facebook.com',
        port: 443,
        path: '/v2.8/me/messages?access_token=' + page_access_token,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': response.length
        }
    };
    // Set up the request
    var post_req = http.request(post_options, function(res) {
        res.setEncoding('utf8');
        res.on('data', function(chunk) {
            callback(null, {
                answered: answered,
                answer: message
            });
        });
        res.on('error', function(e) {
            console.log('Error: ' + e.message);
            callback(e.message);
        });
    });
    // post the data
    post_req.write(response);
    post_req.end();
};

var AnalyzeSentiment = function(message, event, context, callback) {
    var params = {
        FunctionName: process.env.LAMBDA_SENTIMENT_ANALYSIS,
        Payload: JSON.stringify({
            sentence: message
        })
    };
    lambda.invoke(params, function(err, data) {
        if (err) callback(err);
        var payload = JSON.parse(data.Payload);
        console.log("Sentiment Analysis:" + payload.sentiment.compound);
        var doc = {
            sentence: payload.sentence,
            sentiment: payload.sentiment.compound,
            date: new Date().toISOString()
        };
        PostToES(JSON.stringify(doc), event, context, callback);
    });
};


var PostToES = function(doc, event, context, callback) {
    var req = new AWS.HttpRequest(endpoint);
    req.method = 'POST';
    req.path = path.join('/', 'messages', 'message');
    req.region = esDomain.region;
    req.headers['presigned-expires'] = false;
    req.headers['Host'] = endpoint.host;
    req.body = doc;

    var signer = new AWS.Signers.V4(req, 'es');
    signer.addAuthorization(creds, new Date());

    var send = new AWS.NodeHttpClient();
    send.handleRequest(req, null, function(httpResp) {
        var respBody = '';
        httpResp.on('data', function(chunk) {
            respBody += chunk;
        });
        httpResp.on('end', function(chunk) {
            callback(null);
        });
    }, function(err) {
        console.log('Error: ' + err);
        callback(err);
    });
};


var FindAnswer = function(message, event, context, callback) {
    var params = {
        FunctionName: process.env.LAMBDA_NLP,
        Payload: JSON.stringify({
            sentence: message.message.S.replace(/[^\w\s]/gi, '')
        })
    };
    lambda.invoke(params, function(err, data) {
        var response = JSON.parse(data.Payload);
        console.log('NLP processed sentence: ' + response.stemmed_sentence);
        QueryES(message.messageId.S, message.senderId.S, message.message.S.replace(/[^\w\s]/gi, ''), response.stemmed_sentence.substr(0, 230), event, context, callback);
    });
};

var QueryES = function(messageId, sender, raw_question, question, event, context, callback) {
    console.log('Querying ES for an answer');
    var req = new AWS.HttpRequest(endpoint);
    req.method = 'GET';
    req.path = '/knowledgebase/_search?q=question:' + encodeURIComponent(question);
    req.region = esDomain.region;
    req.headers['presigned-expires'] = false;
    req.headers['Host'] = endpoint.host;

    var signer = new AWS.Signers.V4(req, 'es');
    signer.addAuthorization(creds, new Date());

    var send = new AWS.NodeHttpClient();
    send.handleRequest(req, null, function(httpResp) {
        var respBody = '';
        httpResp.on('data', function(chunk) {
            respBody += chunk;
        });
        httpResp.on('end', function(chunk) {
            console.log('ES response:' + respBody);
            ProcessESResponse(messageId, sender, raw_question, JSON.parse(respBody).hits, event, context, callback);
        });
    }, function(err) {
        console.log('Error: ' + err);
        context(err);
    });
};

var ProcessESResponse = function(messageId, sender, raw_question, hits, event, context, callback) {
    console.log('Found ' + hits.total + ' matching answers');
    if (hits.total > 0) {
        console.log('Best score: ' + hits.hits[0]["_score"]);
        if (hits.hits[0]["_score"] < 0.02) {
            // Best scoring answer is below confidence threshold. Send to Slack channel for verification
            SendToSlackForApproval(messageId, sender, raw_question, hits.hits[0]["_source"].answer, event, context, callback);
        } else
            SendFacebookMessage(sender, hits.hits[0]["_source"].answer, "true", event, context, callback);
    } else {
        SendFacebookMessage(sender, 'Unfortunately I did not understand your request. Could you rephrase your question?', "false", event, context, callback);
    }

};

var SendToSlackForApproval = function(messageId, sender, raw_question, answer, event, context, callback) {
    var params = {
        FunctionName: process.env.LAMBDA_SLACK,
        Payload: JSON.stringify({
            action: "send_approval_message",
            messageId: messageId,
            question: raw_question,
            answer: answer
        })
    };
    lambda.invoke(params, function(err, data) {
        if (err) callback(err);
        callback(null, {
            answered: "needs_approval",
            answer: answer
        });
    });
};

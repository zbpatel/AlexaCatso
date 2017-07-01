'use strict';
// Developed by Zac Patel on 6/20/17 with code contributions from Anil Patel
// This code written in part using the sample code provided by Amazon for constructing responses

// importing node packages
var request = require('request');
var _ = require('underscore');
var async = require('async');
var AWS = require('aws-sdk');
var s3;
const kms = new AWS.KMS();


var S3_BUCKET = 'alexaimagecache';
var S3_BASE_URL = `https://s3.amazonaws.com/${S3_BUCKET}/`;
var REDDIT_FILE_KEY = 'redditfiles.json';
var STALE_AFTER = 60*60*1000;

const AWSSECRET = 'AWSSECRET';
const AWSACCESSKEY = 'AWSACCESSKEY';
const REDDITACCESSTOKENURL = 'REDDITACCESSTOKENURL';
const ENVKEYS = [AWSSECRET, AWSACCESSKEY, REDDITACCESSTOKENURL];

var secrets = {};

// uses the async package to run environment variable decryption calls in parallel
function decryptAllEnv(callback) {
    async.each(ENVKEYS, decryptEnv, callback);
}

// decrypts a single environment variable, and adds it to the secrets object
function decryptEnv(envVar, callback) {
    if (secrets[envVar]) {
        callback();
    } else {
        // Decrypt code should run once and variables stored outside of the function
        // handler so that these are decrypted once per container
        kms.decrypt({ CiphertextBlob: new Buffer(process.env[envVar], 'base64') }, (err, data) => {
            if (err) {
                console.error('Decrypt error:', err);
                return callback(err);
            }
            secrets[envVar] = data.Plaintext.toString('ascii');
            callback();
        });
    }
}

// --------------- Helpers that build all of the responses -----------------------

// Standard Speechlet response (used for making non-image responses)
function buildSpeechletResponse(title, output, repromptText, shouldEndSession) {
    return {
        outputSpeech: {
            type: 'PlainText',
            text: output,
        },
        card: {
            type: 'Simple',
            title: `${title}`,
            content: `${output}`,
        },
        reprompt: {
            outputSpeech: {
                type: 'PlainText',
                text: repromptText,
            },
        },
        shouldEndSession,
    };
}

// Constructs a speechlet response that includes an image in the card (that appears in the Alexa companion app)
function buildPhotoSpeechletResponse(title, speechOutput, sImageURL, lImageURL, repromptText, shouldEndSession) {
    return {
        outputSpeech: {
            type: 'PlainText',
            text: speechOutput,
        },
        card: {
            type: 'Standard',
            title: title,
            image: {
                smallImageUrl: sImageURL,
                largeImageUrl: lImageURL
            }
        },
        reprompt: {
            outputSpeech: {
                type: 'PlainText',
                text: repromptText,
            },
        },
        shouldEndSession,
    };
}

// Combines the session attributes and speechlet response, and sends them back to Alexa to be presented to the user
function buildResponse(sessionAttributes, speechletResponse) {
    return {
        version: '1.0',
        sessionAttributes,
        response: speechletResponse,
    };
}

// --------------- Functions that control the skill's behavior -----------------------

function getWelcomeResponse(callback) {
    // If we wanted to initialize the session to have some attributes we could add those here.
    const sessionAttributes = {};
    const cardTitle = 'Welcome';
    const speechOutput = 'Welcome to Cute Cats. Ask me for a photo.';
    // If the user either does not reply to the welcome message or says something that is not
    // understood, they will be prompted again with this text.
    const repromptText = 'Would you like a cat photo?';
    const shouldEndSession = false;

    callback(sessionAttributes,
        buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

function getHelpResponse(callback) {
    // If we wanted to initialize the session to have some attributes we could add those here.
    const sessionAttributes = {};
    const cardTitle = 'Welcome';
    const speechOutput = 'Welcome to Cute Cats. I can send you funny cat photos. Ask me for a photo by saying "Cute Cats, send me a cat photo:".';
    // If the user either does not reply to the welcome message or says something that is not
    // understood, they will be prompted again with this text.
    const repromptText = 'Would you like a cat photo?';
    const shouldEndSession = false;

    callback(sessionAttributes,
        buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

function getErrorResponse(callback) {
    // If we wanted to initialize the session to have some attributes we could add those here.
    const sessionAttributes = {};
    const cardTitle = 'Error';
    const speechOutput = 'Sorry, there was a problem getting a cat photo.';
    const repromptText = 'Would you like to try again to get a cat photo?';
    const shouldEndSession = false;

    callback(sessionAttributes,
        buildSpeechletResponse(cardTitle, speechOutput, repromptText, shouldEndSession));
}

function handleSessionEndRequest(callback) {
    const cardTitle = 'Session Ended';
    const speechOutput = ''; // No speech necessary when the skill ends
    // Setting this to true ends the session and exits the skill.
    const shouldEndSession = true;

    callback({}, buildSpeechletResponse(cardTitle, speechOutput, null, shouldEndSession));
}

// Uploads an image from urlToUpload to the S3 Bucket
function sendImageToS3(urlToUpload, callback) {
    // naming images after the current epoch time of upload (with ms)
    // Also add a random integer because sometimes the millisecond time is the same as another
    let index = Math.floor(Math.random() * 100);
    var myKey = (new Date()).getTime() + index + '.jpg';

    // Requesting our image
    var options = {
        url: urlToUpload,
        encoding: null
    };

    request(options, function (error, response, body) {
        if (error) {
            console.error('Could not authenticate: ' + error.message);
            callback(error);
        } else {
            var params = {Bucket: S3_BUCKET, Key: myKey, Body: body, ACL: 'public-read'};
            s3.putObject(params, function(error, data) {
                if (error) {
                    console.log(error);
                    callback(error);
                } else {
                    console.log(`Successfully uploaded data to ${S3_BUCKET}/${myKey}`);
                    var s3Url = S3_BASE_URL + myKey;
                    callback(undefined, s3Url);
                }
            });
        }
    });
}

// -------------- Main Intent Code --------------
// Broad-scale event handler called from onIntent. This method handles the entire process of querying photos,
// processing them, and sending them to the user's device in the speechlet response
function getCatPhotosHandler(intent, session, callback) {
    // grabbing the image URLs from reddit
    getCachedRedditImages('cats', function(error, imagesFromPosts) {
        if (error) {
            console.error(`Errored when attemping to get images : ${error.message}`);
            getErrorResponse(callback);
        } else {
            // using let instead of var here because we don't need these values outside this scope
            // setting standard vars for output into
            let cardTitle = 'Cat Photo';
            let repromptText = '';
            let sessionAttributes = {};
            let shouldEndSession = true;
            let speechOutput = 'I have sent you a cat photo. Check the Alexa app on your phone.';
            let textOutput = 'Here is your cat photo:';

            // Pick a random image out of the array
            let index = Math.floor(Math.random() * imagesFromPosts.length);
            let imgData = imagesFromPosts[index];
            callback(sessionAttributes,
                buildPhotoSpeechletResponse(cardTitle, speechOutput, imgData.small, imgData.large, repromptText, shouldEndSession));
        }
    });
}

// --------------- Events -----------------------

/**
 * Called when the session starts.
 */
function onSessionStarted(sessionStartedRequest, session) {
    console.log(`onSessionStarted requestId=${sessionStartedRequest.requestId}, sessionId=${session.sessionId}`);
}

/**
 * Called when the user launches the skill without specifying what they want.
 */
function onLaunch(launchRequest, session, callback) {
    console.log(`onLaunch requestId=${launchRequest.requestId}, sessionId=${session.sessionId}`);

    // Dispatch to your skill's launch.
    getWelcomeResponse(callback);
}

/**
 * Called when the user specifies an intent for this skill.
 */
function onIntent(intentRequest, session, callback) {
    console.log(`onIntent requestId=${intentRequest.requestId}, sessionId=${session.sessionId}`);

    const intent = intentRequest.intent;
    const intentName = intentRequest.intent.name;

    // Dispatch to your skill's intent handlers
    if (intentName === 'GETCATPHOTOINTENT') {
        getCatPhotosHandler(intent, session, callback);
    } else if (intentName === 'AMAZON.HelpIntent') {
        getHelpResponse(callback);
    } else if (intentName === 'AMAZON.StopIntent' || intentName === 'AMAZON.CancelIntent') {
        handleSessionEndRequest(callback);
    } else {
        throw new Error('Invalid intent');
    }
}

/**
 * Called when the user ends the session.
 * Is not called when the skill returns shouldEndSession=true.
 */
function onSessionEnded(sessionEndedRequest, session) {
    console.log(`onSessionEnded requestId=${sessionEndedRequest.requestId}, sessionId=${session.sessionId}`);
    // Add cleanup logic here
}


// --------------- Main handler -----------------------

// Route the incoming request based on type (LaunchRequest, IntentRequest,
// etc.) The JSON body of the request is provided in the event parameter.
exports.handler = (event, context, callback) => {
    try {
        console.log(`event.session.application.applicationId=${event.session.application.applicationId}`);

        /**
         * Uncomment this if statement and populate with your skill's application ID to
         * prevent someone else from configuring a skill that sends requests to this function.
         */

        if (event.session.application.applicationId !== 'amzn1.ask.skill.b58f87e5-4321-40fe-ac0d-0c5a5236a405') {
             callback('Invalid Application ID');
        }
        // decrypting environment variables
        decryptAllEnv(function (error) {
            if (error) {
                console.error(`Error decrypting environment variables ${error.message}`);
            }  else { 
                // adding in our access key for AWS
                AWS.config.update({ accessKeyId: secrets[AWSACCESSKEY], secretAccessKey: secrets[AWSSECRET]});
                
                // MUST be done after AWS.config call, otherwise access will be denied to S3
                s3 = new AWS.S3();
                if (event.session.new) {
                    onSessionStarted({ requestId: event.request.requestId }, event.session);
                }

                if (event.request.type === 'LaunchRequest') {
                    onLaunch(event.request,
                        event.session,
                        (sessionAttributes, speechletResponse) => {
                            callback(null, buildResponse(sessionAttributes, speechletResponse));
                        });
                } else if (event.request.type === 'IntentRequest') {
                    onIntent(event.request,
                        event.session,
                        (sessionAttributes, speechletResponse) => {
                            callback(null, buildResponse(sessionAttributes, speechletResponse));
                        });
                } else if (event.request.type === 'SessionEndedRequest') {
                    onSessionEnded(event.request, event.session);
                    callback();
                }
            }
        });
    } catch (err) {
        callback(err);
    }
};

// For one Reddit post, retreive both a small and large preview Url
function getSmallAndLargeImageUrls(redditPost, callback) {
    // Checking to see if a post is flagged as "over 18" to meet Amazon content criteria
    //if (redditPost.)

    // Get the list of previews for the first image, go through the resolutions and pick appropriate sizes
    var previews = redditPost.data.preview.images[0];
    var smallPreview = _.find(previews.resolutions, function(item) { return item.width >= 720 || item.height >= 480; });
    var largePreview = _.find(previews.resolutions, function(item) { return item.width >= 1200 || item.height >= 800; });
    var imgData = {}; // return object

    // If none of the images met the small criteria, choose the last one
    if (!smallPreview) {
        smallPreview = _.last(previews.resolutions);
    }
    // If none of the images met the large criteria, choose the last one
    if (!largePreview) {
        largePreview = _.last(previews.resolutions);
    }

    if (smallPreview) {
        var smallPreviewDecoded = smallPreview.url.replace(/&amp;/g, "&");
        sendImageToS3(smallPreviewDecoded, function(error, s3Url){
            if (error) {
                console.error(`Error uploading to S3: ${error.message}`);
                callback(error);
            } else {
                imgData.small = s3Url;
                // TODO: optimize to upload one image when both previews are the same
                if (largePreview) {
                    var largePreviewDecoded = largePreview.url.replace(/&amp;/g, "&");
                    sendImageToS3(largePreviewDecoded, function(error, s3Url) {
                        if (error) {
                            console.error(`Error uploading to S3: ${error.message}`);
                            callback(error);
                        } else {
                            imgData.large = s3Url;
                            callback(undefined, imgData);
                        }
                    });
                } else {
                    imgData.large = imgData.small;
                    callback(undefined, imgData);
                }
            }
        });
    }
}

// Takes in the name of asubreddit, and finds the location of the preview images all the posts.
// Preview images of all posts are uploaded to S3.  The list of uploaded image Urls is sent
// in the callback as an array of objects.  Each object has a .small and .large field which are
// S3 Urls.
// note, this function does not specifically error trap for bad subreddit names
var getRedditImages = function(subreddit, callback) {
    // First get an access token from Reddit using this OAuth2 workflow
    // https://github.com/reddit/reddit/wiki/OAuth2#application-only-oauth
    var options = {
        // Note: This is clientId:clientSecret@host
        // Saving our request URL to an environment variable for safety reasons
        url: secrets[REDDITACCESSTOKENURL],
        method: 'POST',
        headers: {
            'User-Agent': 'request'
        },
        body: 'grant_type=client_credentials&username=&password='
    };

    request(options, function (error, response, body) {
        if (error) {
            console.error('Could not authenticate: ' + error.message);
            callback(error);
        } else {
            var bodyAsJson = JSON.parse(body);
            // We now have an access token
            var access_token = bodyAsJson.access_token;
            console.log('access token is: ' + access_token);
            var redditPosts;
            var options = {
                method: 'GET',
                url: 'https://oauth.reddit.com/r/' + subreddit + '/top/.json',
                qs: {
                    count: 0
                },
                headers: {
                    'Authorization': 'bearer ' + access_token,
                    'User-Agent': 'agent'
                },
            };
            request(options, function (error, response, body) {
                if (error) {
                    console.error('Failed to get top posts: ' + error.message);
                    callback(error);
                } else {
                    redditPosts = JSON.parse(body).data.children;
                    // Take only 3 items from list
                    redditPosts = redditPosts.slice(0,3);
                    async.map(
                        redditPosts,
                        getSmallAndLargeImageUrls,
                        function(error, imagesFromPosts) {
                            if (error) {
                                console.error(`Failed to process post: ${error.message}`);
                                callback(error);
                            } else {
                                callback(undefined, imagesFromPosts);
                            }
                        }
                    );
                }
            });
        }
    });
};

// Get Reddit images and save them to an S3 file with a timestamp
function updateRedditImagesOnS3(subreddit, callback) {
    getRedditImages(subreddit, function(error, imagesFromPosts) {
        if (error) {
            callback(error);
        } else {
            let fileContents = {
                timestamp: (new Date()).getTime(),
                imagesFromPosts: imagesFromPosts
            };
            // Write this JSON as a string to a S3 file.
            var params = {Bucket: S3_BUCKET, Key: REDDIT_FILE_KEY, Body: JSON.stringify(fileContents)};
            s3.putObject(params, function(error, data) {
                if (error) {
                    console.error(error);
                    callback(error);
                } else {
                    console.log(`Successfully created redddit file`);
                    callback(undefined, imagesFromPosts);
                }
            });
        }
    });
};


// Check to see if reddit.json file exists on S3 and is not older than epsilon time
// If it is, then update the reddit.json file with new data.
function getCachedRedditImages(subreddit, callback) {
    var params = {Bucket: S3_BUCKET, Key: REDDIT_FILE_KEY};
    s3.getObject(params, function(error, data) {
        var bNeedToUpdate = false;
        if (error) {
            // On error, update Reddit images
            bNeedToUpdate = true;
        } else {
            let fileContents = JSON.parse(data.Body);
            let now = (new Date()).getTime();
            if ((now - fileContents.timestamp) > STALE_AFTER) {
                bNeedToUpdate = true;
            } else {
                callback(undefined, fileContents.imagesFromPosts);
            }
        }
        if (bNeedToUpdate) {
            updateRedditImagesOnS3(subreddit, callback);
        }
    });
};


// getCachedRedditImages('cats', function(error, imagesFromPosts) {
//     if (error) {
//         console.error(error);
//     } else {
//         console.log(imagesFromPosts);
//     }
// });



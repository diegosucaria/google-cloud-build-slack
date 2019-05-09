//gcloud beta functions deploy cloudBuildSlackIntegration --project=[here goes your project] --trigger-topic cloud-builds --entry-point subscribe --runtime nodejs8

const { IncomingWebhook } = require('@slack/client');
const humanizeDuration = require('humanize-duration');
const config = require('./config.json');

module.exports.webhook = new IncomingWebhook(config.SLACK_WEBHOOK_URL);
module.exports.status = config.GC_SLACK_STATUS;
module.exports.repos = config.REPOS;

// subscribe is the main function called by GCF.
module.exports.subscribe = async (event) => {
  try {
    const build = module.exports.eventToBuild(event.data);

    console.log("function executed");

    if(build.source === undefined){
      console.log("sourceless build, not sending any notification");
      return;
    }

    const repo = build.source.repoSource.repoName.split('_')[2]; //bitbucket repo name, ie: bitbucket_owner_reponame

    console.log("build for " + repo);

    // Skip if the current repo is not in the repos list.
    if (module.exports.repos.indexOf(repo) === -1) {
      console.log("repo " + repo + " not in the repo list");
      return;
    }

    // Skip if the current status is not in the status list.
    const status = module.exports.status || ['SUCCESS', 'FAILURE', 'INTERNAL_ERROR', 'TIMEOUT'];
    if (status.indexOf(build.status) === -1) {
      console.log("status " + build.status + " not in the status list");
      return;
    }

    console.log("build data:", build);

    const message = await module.exports.createSlackMessage(build);
    // Send message to slack.
    module.exports.webhook.send(message);
  } catch (err) {
    module.exports.webhook.send(`Error: ${err}`);
  }
};

// eventToBuild transforms pubsub event message to a build object.
module.exports.eventToBuild = data => JSON.parse(Buffer.from(data, 'base64').toString());

const DEFAULT_COLOR = '#4285F4'; // blue
const STATUS_COLOR = {
  QUEUED: DEFAULT_COLOR,
  WORKING: DEFAULT_COLOR,
  SUCCESS: '#34A853', // green
  FAILURE: '#EA4335', // red
  TIMEOUT: '#FBBC05', // yellow
  INTERNAL_ERROR: '#EA4335', // red
};

// createSlackMessage create a message from a build object.
module.exports.createSlackMessage = async (build) => {
  const buildFinishTime = new Date(build.finishTime);
  const buildStartTime = new Date(build.startTime);

  const isWorking = build.status === 'WORKING';
  const timestamp = Math.round(((isWorking) ? buildStartTime : buildFinishTime).getTime() / 1000);

  const text = (isWorking)
    ? `build \`${build.id}\` started`
    : `build \`${build.id}\` finished`;

  text = "*GOOGLE CLOUD BUILD:* " + text;

  const source = build.source || null;

  const fields = [{
    title: 'Status',
    value: build.status,
    short: (source ? true : false)
  }];

  if (!isWorking) {
    const buildTime = humanizeDuration(buildFinishTime - buildStartTime);

    fields.push({
      title: 'Duration',
      value: buildTime,
      short: true
    });
  }

  const message = {
    text,
    mrkdwn: true,
    attachments: [
      {
        color: STATUS_COLOR[build.status] || DEFAULT_COLOR,
        title: 'Build logs',
        title_link: build.logUrl,
        fields,
        footer: 'Google Cloud Build',
        footer_icon: 'https://ssl.gstatic.com/pantheon/images/containerregistry/container_registry_color.png',
        ts: timestamp,
      },
    ],
  };

  // Add source information to the message.
  if (source) {
    message.attachments[0].fields.push({
      title: 'Repository',
      value: build.source.repoSource.repoName.split('_')[2],  //bitbucket repo name, ie: bitbucket_owner_reponame
      short: true
    });

    message.attachments[0].fields.push({
      title: 'Branch',
      value: build.source.repoSource.branchName,
      short: true
    });

  }

  // Add images to the message.
  const images = build.images || [];
  // eslint-disable-next-line no-plusplus
  for (let i = 0, len = images.length; i < len; i++) {
    message.attachments[0].fields.push({
      title: 'Image',
      value: images[i],
    });
  }
  return message;
};

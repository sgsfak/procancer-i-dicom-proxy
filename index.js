const config = require("config");
const fastify = require('fastify')({ logger: true })
const helmet = require('fastify-helmet');
const fileUpload = require('fastify-file-upload')
const fs = require("fs/promises");
const os = require("os");
const path = require('path')
const {_} = require("lodash")
 
fastify.register(fileUpload, {
    useTempFiles : true,
    tempFileDir : '/tmp/'
});

fastify.register(require('fastify-static'), {
  root: path.join(__dirname, config.storagePath)
});

const {parseDicomFile, getSeriesMetadata, getSeriesMetadataList, imagesOfSeries, 
       segmentationsOfSeries, downloadSeries, dicomUploadDir} = require("./dicom");
fastify.register(
    helmet,
    // Example disables the `contentSecurityPolicy` middleware but keeps the rest.
    { contentSecurityPolicy: false ,
      referrerPolicy: "no-referrer" },
  );

fastify.register(require('fastify-cors'), { 
    methods: ['GET', 'PUT', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
});

  
// Declare a route
fastify.get('/', async (request, reply) => {
    return { hello: 'world' }
})

fastify.get('/series/:seriesUid/metadata', async (request, reply) => {
    const {seriesUid} = request.params;
    const json = await getSeriesMetadata(seriesUid);
    return json
})

function imageUrlFor(studyUid, seriesUid, instanceUid)
{
    return `${config.serverUri}/files/${studyUid}/${seriesUid}/${instanceUid}`;
}

async function getSeriesSegmentationsUrls(segmentations)
{
    const seriesUids = _.uniq(segmentations.map(el => el.seriesUid));
    console.info(`Going to retrieve ${seriesUids.length} series metadata...`);
    const seriesData = await getSeriesMetadataList(seriesUids);
    const studyOfSeries = new Map();
    seriesData.forEach(({SeriesInstanceUID, StudyInstanceUID}) => {
        studyOfSeries.set(SeriesInstanceUID, StudyInstanceUID);
    });
    return segmentations.map( ({seriesUid, instanceUid}) => imageUrlFor(studyOfSeries.get(seriesUid), seriesUid, instanceUid));
}

fastify.get('/series/:seriesUid', async (request, reply) => {
    const {seriesUid} = request.params; // "1.3.6.1.4.1.14519.5.2.1.2744.7002.117357550898198415937979788256";
    console.log("%O", request.params);
    const series= await getSeriesMetadata(seriesUid);
    const [images, segmentations] = await Promise.all([imagesOfSeries(seriesUid), segmentationsOfSeries(seriesUid)]);
    const image_urls = images.map(({seriesUid, instanceUid}) => imageUrlFor(series.StudyInstanceUID, seriesUid, instanceUid));
    const segmentations_urls = await getSeriesSegmentationsUrls(segmentations);
    return {...series, images: image_urls, segmentations: segmentations_urls};
})

fastify.get('/rois/:seriesUid', async (request, reply) => {
    const {seriesUid} = request.params; // "1.3.6.1.4.1.14519.5.2.1.2744.7002.117357550898198415937979788256";
    console.log("%O", request.params);
    const segmentations = await segmentationsOfSeries(seriesUid);
    const segmentations_urls = await getSeriesSegmentationsUrls(segmentations);
    return segmentations_urls;
})

async function fileExists(pathname)
{
    let exists = false;
    try {
        await fs.access(pathname);
        exists = true;
    } catch (e) {
    }
    return exists;
}

fastify.get('/files/:studyUid/:seriesUid/:instanceUid', async (request, reply) => {
    const {studyUid, seriesUid, instanceUid} = request.params;
    console.log("%O", request.params);
    // const pathname = `${studyUid}/${seriesUid}/${instanceUid}`;
    const pathname = `${studyUid}/${instanceUid}`;
    let exists = await fileExists(path.join(__dirname, config.storagePath, pathname));
    if (!exists) {
        console.log("FILE DOES NOT EXIST LOCALLY");
        try {
            await downloadSeries(studyUid, seriesUid);
        } catch (e) {
            console.error("FETCHING FILE ERROR:" + e);
            return reply.status(500).send('C-GET failed');
        }
    }

    exists = await fileExists(path.join(__dirname, config.storagePath, pathname));
    if (!exists) {
        return reply.status(404).send('Not found');
    }
    else {
        return reply.type("application/dicom").sendFile(pathname);
    }
})

// Upload registration:

async function mvToUploadDir(dir, fileInfo)
{
    return new Promise((resolve, reject) => {
        const {mv, name} = fileInfo;
        console.log(`Moving ${name} to ${dir}`);
        mv(dir + name, function (err) {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}
fastify.post('/series/:seriesUid', async (request, reply) => {
    const {seriesUid} = request.params;

    const uploads = _.values(request.raw.files || {});
    if (uploads.length === 0) {
        return reply.status(400).send({error: 'No files were given.'});
    }
    let ret = [];
    for (let index = 0; index < uploads.length; index++) {
        const {tempFilePath} = uploads[index];

        const info = await parseDicomFile(tempFilePath);
        console.log("%O", info);
        if (info.Modality !== "SEG" || !info.referencedSeries) {
            return reply.status(400).send({error: 'File not in DICOM-SEG format!'});
        }
        if (!info.referencedSeries.includes(seriesUid)) {
            return reply.status(400).send({error: `File does not reference Series ${seriesUid}`});
        }
        // return reply.send(info);
        // ret.push(info);
    }

    const dir = await fs.mkdtemp(await fs.realpath(os.tmpdir())) + path.sep;
    console.log("Created " + dir);
    for (let index = 0; index < uploads.length; index++) {
        await mvToUploadDir(dir, uploads[index]);
    }
    ret = await dicomUploadDir(dir);
    reply.send(ret);
});

// Run the server!
const start = async () => {
    try {
      await fastify.listen(3000);
    } catch (err) {
      fastify.log.error(err)
      process.exit(1)
    }
  }


  start()
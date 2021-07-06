const config = require("config");
const fastify = require('fastify')({ logger: true })
const helmet = require('fastify-helmet');
const fs = require("fs/promises");
const path = require('path')

fastify.register(require('fastify-static'), {
  root: path.join(__dirname, config.storagePath)
});

const {getSeriesMetadata, imagesOfSeries, segmentationsOfSeries, downloadSeries} = require("./dicom");
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

fastify.get('/series/:seriesUid', async (request, reply) => {
    const {seriesUid} = request.params; // "1.3.6.1.4.1.14519.5.2.1.2744.7002.117357550898198415937979788256";
    console.log("%O", request.params);
    const series= await getSeriesMetadata(seriesUid);
    const [images, segmentations] = await Promise.all([imagesOfSeries(seriesUid), segmentationsOfSeries(seriesUid)]);
    const image_urls = images.map(({seriesUid, instanceUid}) => imageUrlFor(series.StudyInstanceUID, seriesUid, instanceUid));
    const segmentations_urls = segmentations.map(({seriesUid, instanceUid}) => imageUrlFor(series.StudyInstanceUID, seriesUid, instanceUid));
    return {...series, images: image_urls, segmentations: segmentations_urls};
})

fastify.get('/rois/:seriesUid', async (request, reply) => {
    const {seriesUid} = request.params; // "1.3.6.1.4.1.14519.5.2.1.2744.7002.117357550898198415937979788256";
    console.log("%O", request.params);
    const {StudyInstanceUID} = await getSeriesMetadata(seriesUid);
    const segmentations = await segmentationsOfSeries(seriesUid);
    const segmentations_urls = segmentations.map(({seriesUid, instanceUid}) => imageUrlFor(StudyInstanceUID, seriesUid, instanceUid));
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
    const exists = await fileExists(path.join(__dirname, config.storagePath, pathname));
    if (!exists) {
        console.log("FILE DOES NOT EXIST LOCALLY");
        try {
            await downloadSeries(studyUid, seriesUid);
        } catch (e) {
            console.error("FETCHING FILE ERROR:" + e);
            const msg = `fetch failed`;
            throw msg;
        }
    }
    return reply.type("application/dicom").sendFile(pathname);
})

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
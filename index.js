const config = require("config");
const fastify = require('fastify')({ logger: true })
const helmet = require('fastify-helmet');
const fs = require("fs");
const path = require('path')

fastify.register(require('fastify-static'), {
  root: path.join(__dirname, config.storagePath)
});

const {imagesOfSeries, segmentationsOfSeries, getImage} = require("./dicom");
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

fastify.get('/series/:seriesUid', async (request, reply) => {
    const {seriesUid} = request.params; // "1.3.6.1.4.1.14519.5.2.1.2744.7002.117357550898198415937979788256";
    console.log("%O", request.params);
    const [images, segmentations] = await Promise.all([imagesOfSeries(seriesUid), segmentationsOfSeries(seriesUid)]);
    return {images, segmentations}
})


fastify.get('/rois/:seriesUid', async (request, reply) => {
    const {seriesUid} = request.params; // "1.3.6.1.4.1.14519.5.2.1.2744.7002.117357550898198415937979788256";
    console.log("%O", request.params);
    return await segmentationsOfSeries(seriesUid);
})

function fileExists(pathname) {
    return new Promise((resolve, reject) => {
      fs.access(pathname, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
}

fastify.get('/instances/:studyUid/:seriesUid/:instanceUid', async (request, reply) => {
    const {studyUid, seriesUid, instanceUid} = request.params;
    console.log("%O", request.params);
    // const pathname = `${studyUid}/${seriesUid}/${instanceUid}`;
    const pathname = `${studyUid}/${instanceUid}`;
    // let exists = await fileExists(pathname);
    try {
        await fileExists(path.join(config.storagePath, pathname));
    } 
    catch (error) {
        console.log("FILE DOES NOT EXIST LOCALLY");
        try {
            await getImage(studyUid, seriesUid, instanceUid);
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
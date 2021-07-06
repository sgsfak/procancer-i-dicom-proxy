const dimse = require('dicom-dimse-native');
const config = require("config");
const util = require('util');

// const target = config["target-dicomserver"];
const target = config["target"];
function findSeries (seriesUid) {
    let q = {
        source: config.source, target,
        tags: [
            {key: "00100010", value: ""}, // Patient Name
            {key: "00100020", value: ""}, // PatientID
            {key: "0020000D", value: ""}, // StudyInstanceUID 
            {key: '00080060', value: ""}, // Modality
            {key: '0008103E', value: ""}, // SeriesDescription
            {key: '00200011', value: ""}, // SeriesNumber
            {key: '00201209', value: ""},
            {key: '00080018', value: ""}, // SOPInstanceUID 
            {key: "00201002", value: ""},
            {key: "00201003", value: ""}, // ImagesInSeries
            
            {
                key: "0020000E",  // SeriesInstanceUID
                value: seriesUid,
            },
            {
                key: "00080052", 
                value: "SERIES",
            },
        ]
    }
    return new Promise((resolve, reject) => {
        dimse.findScu(JSON.stringify(q), (result) => {
            try {
                const response = JSON.parse(result);
                const dicom_json = JSON.parse(response.container)
                // console.log("Found %s images", dicom_json.length);
                // const image_uids = dicom_json.map(element => element["00080018"].Value[0]);
                // image_uids.forEach(element => console.log(element));
                console.log(response.container);
                resolve(response.container);
            }
            catch (e) {
                reject(e);
            }
        });
    });
}

function imagesOfSeries (seriesUid) {
    let q = {
        source: config.source, target,
        tags: [
            {key: "0020000D", value: ""}, // StudyInstanceUID 
            {key: '00080018', value: ""}, // SOPInstanceUID
            {
                key: "0020000E",  // SeriesInstanceUID
                value: seriesUid,
            },
            {
                key: "00080052", 
                value: "IMAGE",
            },
        ]
    }
    return new Promise((resolve, reject) => {
        dimse.findScu(JSON.stringify(q), (result) => {
            try {
                const response = JSON.parse(result);
                if (!response.container) {
                    console.log("Found 0 images, %O", response);
                    resolve([]);
                }
                const dicom_json = JSON.parse(response.container)
                const image_uids = dicom_json.map(element => {
                    const studyUid = element["0020000D"].Value[0];
                    const seriesUid = element["0020000E"].Value[0];
                    const instanceUid = element["00080018"].Value[0];
                    return {studyUid, seriesUid, instanceUid, url: `/instances/${studyUid}/${seriesUid}/${instanceUid}`};
                });
                resolve(image_uids);
            }
            catch (e) {
                reject(e);
            }
        });
    });
}


function segmentationsOfSeries (seriesUid) {
    let q = {
        source: config.source, target,
        tags: [
            {key: "0020000E", value: ""}, // SeriesInstanceUID
            {key: '00080018', value: ""}, // SOPInstanceUID
            {key: '00080060', value: 'SEG'}, // Modality == SEG
            {
                key: "00081155",  // ReferencedSOPInstanceUID
                value: {
                    key: "0020000E",  // SeriesInstanceUID
                    value: seriesUid,
                }
            },
            {
                key: "00080052", 
                value: "IMAGE",
            },
        ]
    }
    return new Promise((resolve, reject) => {
        dimse.findScu(JSON.stringify(q), (result) => {
            try {
                const response = JSON.parse(result);
                if (!response.container) {
                    console.log("Found 0 images, %O", response);
                    resolve([]);
                }
                const dicom_json = JSON.parse(response.container)
                const image_uids = dicom_json.map(element => {
                    const seriesUid = element["0020000E"].Value[0];
                    const instanceUid = element["00080018"].Value[0];
                    return {seriesUid, instanceUid, url: `/instances/${seriesUid}/${instanceUid}`};
                });
                // console.log(response.container);
                resolve(image_uids);
            }
            catch (e) {
                reject(e);
            }
        });
    });
}


function getImage (studyUid, seriesUid, imageUid) {

    const ts = config.get('transferSyntax');
    const j = {
        source: config.source, target,
        storagePath : config.get('storagePath'),
        netTransferPrefer : ts,
        netTransferPropose : ts,
        writeTransfer : ts,
        verbose: false,
        tags: [
            { key: '00080052', value: 'IMAGE'  },
            // { key: '0020000D', value: studyUid },
            { key: '0020000E', value: seriesUid},
            { key: '00080018', value: imageUid }
        ]
      };

    const uidPath = `${studyUid}/${seriesUid}/${imageUid}`;
    // const cacheTime = config.get('keepCacheInMinutes');

    const prom = new Promise((resolve, reject) => {
        try {
            console.info(`fetch start: ${uidPath}`);
            // clearCache(j.storagePath, studyUid);
            dimse.getScu(JSON.stringify(j), (result) => {
                if (result && result.length > 0) {
                    try {
                        const json = JSON.parse(result);
                        if (json.code === 0 || json.code === 2) {
                            console.info(`fetch finished: ${uidPath}`);
                            resolve(result);
                        } else {
                            console.info(JSON.parse(result));
                        }
                    } catch (error) {
                        reject(error, result);
                    }
                    // lock.delete(lockId);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
    // store in lock
    // lock.set(lockId, prom);
    return prom;
};

module.exports = {findSeries, imagesOfSeries, segmentationsOfSeries, getImage};
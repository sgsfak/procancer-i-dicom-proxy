const dimse = require('dicom-dimse-native');
const config = require("config");
const throat = require('throat')(config.get('maxAssociations'));
const _ = require("lodash")

// const target = config["target-dicomserver"];
const target = config["target"];


const dictionary = {
    "study": {
        "00100010": "PatientName",
        "00100020": "PatientID",
        "0020000D": "StudyInstanceUID"
    },
    "series": {
        "0020000D": "StudyInstanceUID",
        "0020000E": "SeriesInstanceUID",
        "00080060": "Modality",
        "0008103E": "SeriesDescription",
        "00200011": "SeriesNumber",
        "00201209": "NumberOfSeriesRelatedInstances",
        "00201002": "ImagesInAcquisition",
        "00201003": "ImagesInSeries"
    },
    "instance": {
        "0020000E": "SeriesInstanceUID",
        "00080018": "SOPInstanceUID"
    }
}

function dicomJson2Json(dict, dicom_json)
{
    let ret = {}
    dicom_json.forEach(o => {
        _.toPairs(o).forEach( ([t,v]) => {
            let name = _.get(dict, t, t);
            let value = _.get(v, ["Value", "0"], "");   
            ret[name] = value;
        })
    });
    return ret;
}

function getSeriesMetadata (seriesUid) {
    let search = _.fromPairs(_.keys(dictionary.series).map(x => [x, ""]));
    search["0020000E"] = seriesUid;
    search["00080052"] = "SERIES";

    let q = {
        source: config.source, target,
        tags: _.toPairs(search).map( v => _.zipObject(["key", "value"], v))
    }
    return new Promise((resolve, reject) => {
        dimse.findScu(JSON.stringify(q), (result) => {
            try {
                const response = JSON.parse(result);
                if (!response.container) {
                    reject('not found');
                    return;
                }
                const dicom_json = JSON.parse(response.container)
                let res = dicomJson2Json(dictionary.series, dicom_json);
                resolve(res);
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
                // console.log("RESP: %O", dicom_json);
                const image_uids = dicom_json.map(element => {
                    const seriesUid = element["0020000E"].Value[0];
                    const instanceUid = element["00080018"].Value[0];
                    return {seriesUid, instanceUid};
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
                    return {seriesUid, instanceUid};
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


const locks = new Map();

function fetchSeries(studyUid, seriesUid, lockId) {

    const ts = config.get('transferSyntax');
    const j = {
        source: config.source, target,
        storagePath : config.get('storagePath'),
        netTransferPrefer : ts,
        netTransferPropose : ts,
        writeTransfer : ts,
        verbose: false,
        tags: [
            { key: '00080052', value: 'SERIES'  },
            // { key: '0020000D', value: studyUid },
            { key: '0020000E', value: seriesUid},
            // { key: '00080018', value: imageUid }
        ]
      };

    // const uidPath = `${studyUid}/${seriesUid}/${imageUid}`;
    const uidPath = `${studyUid}/${seriesUid}`;
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
                            console.info(`fetch finished, status: ${json.status} path: ${uidPath}`);
                            resolve(json);
                        } else {
                            console.info(result);
                        }
                    } catch (error) {
                        reject(error, result);
                    }
                    locks.delete(lockId);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
    // store in lock
    locks.set(lockId, prom);
    return prom;
};

async function downloadSeries(studyUid, seriesUid) {
    const lockId = `${studyUid}/${seriesUid}`;

    // check if already locked and return promise
    if (locks.has(lockId)) {
        return locks.get(lockId);
    }

    return throat(async () => {
        await fetchSeries(studyUid, seriesUid, lockId);
    });
}

module.exports = {getSeriesMetadata, imagesOfSeries, segmentationsOfSeries, downloadSeries};
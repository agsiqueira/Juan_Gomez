let numUnfocusedQuestions = 0;

// 2d array for interaction logging
let logData = []

// Base for Maria videos (CHANGE THIS IF YOU NEED TO DO DIFFERENT VH)
const AWS_videoURL_Base = "https://agsdentistry.s3.us-east-1.amazonaws.com/assets/videos/interaction";

// Attaches audio to the video player so that it plays
let audioPlayer = document.getElementById('myAudio');

let queuedVid = null;

// API endpoint for chatgpt & google cloud access
const ENDPOINT_URL = 'https://verg-api-zone.cise.ufl.edu/';

// interaction chat box
const chatBox = document.getElementById('chat-box');

// user message box input
const userInput = document.getElementById('chatInput');

// add all event listeners after DOM content is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Ensure video appears
    // showMaria();

    const idle = document.getElementById("idleVideo");
    idle.onended = () => {
        if (queuedVid) {
            const url = queuedVid;
            queuedVid = null;
            const vid = changeVid(url);

            idle.style.opacity = "0";
            vid.style.opacity = "1";
            vid.play();

            vid.onended = () => {
                switchIdle();
                if (sceneCompleted) {
                    // scene completed is target scene, so make the next scene the target
                    if (curScene === curTargetScene) {
                        curTargetScene++;
                    }
                    // change completed scene number on the popup and display it
                    document.getElementById('concludedScene').innerText = `Parabéns, cena ${curScene} concluída`;
                    document.getElementById('sceneConclusion').style.display = 'flex';
                    sceneCompleted = false;
                }
            }
        }
        else {
            idle.currentTime = 0;
            idle.play();
        }
    };

    // trigger send via button click
    document.getElementById('send-button').addEventListener('click', sendMessage);

    // trigger send via enter key
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    setTimeout(addSTTButton, 1500);

    // add button functionality to each of the scene discovery dropdowns
    const buttons = document.querySelectorAll('.disc_category');
    buttons.forEach(button => {
        button.addEventListener('click', () => {
            const sceneContent = button.nextElementSibling;
            if (sceneContent.style.display === 'none' || sceneContent.style.display === '') {
                sceneContent.style.display = 'block';
            }
            else {
                sceneContent.style.display = 'none';
            }
        });
    });

    // add functionality to popups' close button
    document.querySelectorAll('.close-button').forEach(button => {
        button.addEventListener('click', () => {
            button.closest('.popup-overlay').style.display = 'none';
        });
    });
});

// sends user message to GPT API
async function sendMessage() {
    const text = userInput.value.trim();
    if (text === '') return;

    const newMsgDiv = document.createElement('div');
    newMsgDiv.textContent = text;
    newMsgDiv.className = 'df-message-bubble user';
    chatBox.appendChild(newMsgDiv);

    userInput.value = '';

    const newResDiv = document.createElement('div');
    newResDiv.textContent = "\t...\t";
    newResDiv.className = 'df-message-bubble bot';
    chatBox.appendChild(newResDiv);
    chatBox.scrollTop = chatBox.scrollHeight;

    console.log("Input to GPT:", text);

    let res;
    try {
        const response = await fetch(ENDPOINT_URL + 'JuanGomez/chat_exact', {
            method: 'POST',
            headers: { "Content-Type": "application/json", },
            body: JSON.stringify({ 
                message: text,
                session_id: "1"
            })
        });

        res = await response.json();
        console.log("GPT Response: ", res);
    } catch (error) {
        console.error("Error:", error);
        return;
    }

    const replyText = res.answer;
    const replyId = res.answer_id;
    const similarity = res.similarity;

    newResDiv.textContent = replyText;

    if (replyId !== -1) {
        // checks if this is the first time intent has been found
        // if (!allIntents[replyId].found) {
        //     // marks intent as found
        //     allIntents[replyId].found = true;

            // new intent related question --> reset counter for unfocused questions
            numUnfocusedQuestions = 0;

            // curScene = allIntents[replyId].scene;
            // // increments respective scene and total discovery counts
            // scenes[curScene].curCount++;
            // curDiscTotal++;

            // // inserts new HTML div element for newly found discovery into its proper scene
            // let new_disc_html = "<div>" + "- "+ allIntents[replyId].desc + "</div>";
            // let htmlID = "scene" + curScene;
            // document.getElementById(htmlID + "_discs").innerHTML = new_disc_html + 
            //     document.getElementById(htmlID + "_discs").innerHTML;

            // edit HTML text element for # of discoveries found per scene
            // const indexOfCount = document.getElementById(htmlID).textContent.indexOf("(");
            // document.getElementById(htmlID).textContent = document.getElementById(htmlID).textContent.substring(0, indexOfCount) + 
            //     `(${scenes[curScene].curCount}/${scenes[curScene].totalCount})`;

            // // highlight most recent discovery scene by turning it orange (un-highlight prev)
            // Object.keys(scenes).forEach(i => {
            //     if (i == curScene) {
            //         document.getElementById("scene" + i).parentElement.classList.add("active");
            //     }
            //     else {
            //         document.getElementById("scene" + i).parentElement.classList.remove("active");
            //     }
            // });

            // // ensure discovery's respective scene content is displayed (even if was hidden previously by button click)
            // document.getElementById(htmlID).parentElement.nextElementSibling.style.display = 'block';

            // // update total discovery count
            // document.getElementById("discoveries").querySelector("h1").textContent = `Discoveries (${curDiscTotal}/${goalDiscTotal})`;

            // // checks if scene is completed
            // if (scenes[curScene].curCount === scenes[curScene].totalCount) {
            //     // mark scene as completed so that pop up works
            //     sceneCompleted = true;
            // }
        // }
        // else {  // intent related question already asked previously
        //     numUnfocusedQuestions++;
        // }

        console.log(replyId);
        console.log(String(replyId).length);
        const videoId = ("0").repeat(3 - String(replyId).length) + replyId;
        console.log("Formatted video ID: ", videoId);
        const videoURL = AWS_videoURL_Base + videoId + ".mp4";
        console.log("Change to this: " + videoURL);
        queuedVid = videoURL;
    }
    else {  // question not intent related
        await GenerateTTS(replyText);

        // add question and reply texts to popup and show
        document.getElementById('question').innerText = text;
        document.getElementById('reply').innerText = replyText;
        document.getElementById('gptAnswer').style.display = 'flex';

        audioPlayer.play();
        audioPlayer.onended = () => {
            switchIdle();
        };

        numUnfocusedQuestions++;
    }

    logData.push(
        [text, replyText, replyId]
    );

    console.log("Num Unfocused Questions: ", numUnfocusedQuestions);
    if (numUnfocusedQuestions >= 3) {
        unfocusedPopUp();
    }
}

function showMaria() {
    document.getElementById("myVideo").style.display = "block";
    document.getElementById("idleVideo").style.display = "block";
}

function switchIdle() {
    const video = document.getElementById("myVideo");
    const idle = document.getElementById("idleVideo");

    video.pause();
    video.style.opacity = "0";

    idle.currentTime = 0;
    idle.style.opacity = "1";
    idle.play();
}

//Add Parameter to Change Video Based on Intent Name
function changeVid(URL) {
    const vid = document.getElementById("myVideo");
    
    vid.src = URL;
    vid.load();
    vid.muted = false;
    vid.currentTime = 0;

    return vid;
}

function unfocusedPopUp() {
    // let objList = "";
    // // loop through each discovery intent of the current scene and add to html list
    // Object.keys(allIntents).forEach(key => {
    //     const intent = allIntents[key];
    //     if (intent.scene === curTargetScene) {
    //         objList += "<p>" + "- " + intent.desc + "</p>";
    //     }
    // });
    // // add list to popup and show it
    // document.getElementById("sceneObjectives").innerHTML = objList
    document.getElementById('focusPopup').style.display = 'flex';
}

// Generates Text-To-Speech Audio
async function GenerateTTS(gptResponse){
    gptResponse = gptResponse.replace(/\([^)]*\)/g, "")
    try{
        const payload = {
            text: gptResponse,
            language_code: "es-US",
            voice_name: "es-US-Chirp3-HD-Iapetus"
        };

        // get Google Cloud Speech-to-Text API response from endpoint
        const response = await fetch(ENDPOINT_URL + 'api/googlecloudtts', {
            headers: { "Content-Type": "application/json" },
            method: 'POST',
            body: JSON.stringify(payload)
        });

        // creates audio blob and attaches to client's audio player
        const audioBLob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBLob);
        audioPlayer.src = audioUrl;
    }
    catch (error) {
        console.error("Error in TTS:", error);
        return "";
    }
}

// calculates root mean square of audio frequencies to determine how loud the current microphone input is
function getRMS(arr) {
    let sumSquares = 0;
    for (const val of arr) {
        sumSquares += val*val;
    }
    return Math.sqrt(sumSquares / arr.length) / 255;
}

// adds speech to text functionality
function addSTTButton() {
    const micButton = document.getElementById('mic-button');
    
    let mediaRecorder;
    let audioChunks = [];
    let isRecording = false;

    let audioContext;
    let analyser;
    let sourceNode;
    let silenceStart = null;
    let silenceDetectInterval;

    const silenceThreshold = 0.2;
    const silenceDelay = 2000;

    // button can only start recording (no clickable stop)
    micButton.addEventListener('click', () => {
        if (!isRecording) {
            startRecording();
        }
    });

    async function startRecording() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
    
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        sourceNode = audioContext.createMediaStreamSource(stream);
        sourceNode.connect(analyser);
        analyser.fftSize = 512;

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });

            audioChunks = [];

            let extension = audioBlob.type.split('/')[1].split(';')[0];

            const formData = new FormData();
            formData.append('audio', audioBlob, `recording.${extension}`);
            formData.append('language_code', 'pt-BR');

            const response = await fetch(ENDPOINT_URL + 'api/googlecloudstt', {
                method: 'POST',
                body: formData,
            });

            const result = await response.json();
            console.log('Server response: ', result);

            userInput.value = result.transcript;
            userInput.dispatchEvent(new Event('input', { bubbles: true }));
            sendMessage();

            clearInterval(silenceDetectInterval);
            silenceDetectInterval = null;

            if (audioContext) {
                audioContext.close();
                audioContext = null;
                analyser = null;
                sourceNode = null;
            }
        };

        mediaRecorder.start();
        isRecording = true;
        micButton.innerHTML = '⏳';
        micButton.title = 'Gravando...'

        silenceStart = null;
        silenceDetectInterval = setInterval(() => {
            const arr = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(arr);

            const rms = getRMS(arr);

            if (rms < silenceThreshold) {
                if (!silenceStart)
                    silenceStart = Date.now();
                else if (Date.now() - silenceStart > silenceDelay) {
                    stopRecording();
                }
            }
            else {
                silenceStart = null;
            }
        }, 100);
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
        }
        isRecording = false;
        micButton.innerHTML = '🎤';
        micButton.title = 'Clique para falar';
    } 
}

// Creates the log file and downloads it locally on user's system
async function CreateLogFile() {
    const formUrl = "https://docs.google.com/forms/d/e/1FAIpQLSfPxO3FT8BRMBOmWop4U7ljOiOE5lnTIb3nqTPvoFwcKqJxxQ/formResponse";
    const fieldIds = {
        question: "entry.413257006",
        answer: "entry.253578126",
        intentId: "entry.329507193"
    };

    for (const row of logData) {
        const formData = new FormData();
        formData.append(fieldIds.question, row[0]);
        formData.append(fieldIds.answer, row[1]);
        formData.append(fieldIds.intentId, row[2]);

        await fetch(formUrl, {
            method: "POST",
            body: formData,
            mode: "no-cors"
        });

        console.log("Log sent: ", row)
    }
}

function redirectPage() {
    CreateLogFile();

    const outroIframe = document.getElementById('outro'); 
    outroIframe.style.display = 'block';

    const video7 = outroIframe.contentWindow.document.getElementById('myVideo7');
    video7.style.display = 'block'
    video7.currentTime = 0;
    video7.play().catch(err => console.log('Video play failed:', err));
}

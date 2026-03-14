const App = {

state: {
    numUnfocusedQuestions: 0,
    logData: [],
    queuedVid: null,
    isSending: false,

    interactionStartTime: null,

    opioidPromptIntervalId: null,

    mediaRecorder: null,
    audioChunks: [],
    isRecording: false,
    stream: null,

    audioContext: null,
    analyser: null,
    sourceNode: null,
    silenceStart: null,
    silenceDetectInterval: null,

    sessionId: null
},

config: {

    AWS_videoURL_Base: "https://agsdentistry.s3.us-east-1.amazonaws.com/assets/videos/interaction/",
    ENDPOINT_URL: "https://verg-api-zone.cise.ufl.edu/",

    intentMinId: 1,
    intentMaxId: 150,

    opioidPromptIntervalMs: 180000,

    opioidVideoId: 427,

    opioidText: "I'm in pain. Don't bother with the regular stuff; it never works. I need something much stronger. Can I have percocet?"
},

elements: {},


init() {

    this.cacheElements()

    this.initSession()

    this.state.interactionStartTime = Date.now()

    this.bindEvents()

    this.showMaria()

    this.setupIdleVideo()

    this.startOpioidPromptTimer()

    setTimeout(() => this.setupSTT(), 1500)

},


cacheElements(){

    this.elements.audioPlayer = document.getElementById("myAudio")

    this.elements.chatBox = document.getElementById("chat-box")

    this.elements.userInput = document.getElementById("chatInput")

    this.elements.sendButton = document.getElementById("send-button")

    this.elements.micButton = document.getElementById("mic-button")

    this.elements.mainVideo = document.getElementById("myVideo")

    this.elements.idleVideo = document.getElementById("idleVideo")

    this.elements.focusPopup = document.getElementById("focusPopup")

    this.elements.outroIframe = document.getElementById("outro")

},


initSession(){

    let sessionId = sessionStorage.getItem("vh_session_id")

    if(!sessionId){

        sessionId = crypto.randomUUID()

        sessionStorage.setItem("vh_session_id",sessionId)

    }

    this.state.sessionId = sessionId

},


bindEvents(){

    this.elements.sendButton.addEventListener("click",()=>this.sendMessage())

    this.elements.userInput.addEventListener("keydown",(e)=>{

        if(e.key==="Enter"){

            e.preventDefault()

            this.sendMessage()

        }

    })



    const inspectBtn = document.getElementById("inspectTeethBtn")

    if(inspectBtn){

        inspectBtn.addEventListener("click",()=>{

            const popup=document.getElementById("teethPopup")

            popup.style.display="flex"

            this.state.logData.push([
                "[SYSTEM ACTION]",
                "User inspected teeth",
                "teeth_inspection"
            ])

        })

    }



    document.querySelectorAll(".close-button").forEach(button=>{

        button.addEventListener("click",()=>{

            button.closest(".popup-overlay").style.display="none"

        })

    })

},


getElapsedTimeLabel(){

    const elapsedMs = Date.now() - this.state.interactionStartTime

    const totalSeconds = Math.floor(elapsedMs / 1000)

    const minutes = Math.floor(totalSeconds / 60)

    const seconds = totalSeconds % 60

    return `[${String(minutes).padStart(2,"0")}:${String(seconds).padStart(2,"0")}]`

},


formatChatMessage(text){

    return `${this.getElapsedTimeLabel()} ${text}`

},


appendMessage(text,sender){

    const div=document.createElement("div")

    div.textContent=this.formatChatMessage(text)

    div.className=`df-message-bubble ${sender}`

    this.elements.chatBox.appendChild(div)

    this.elements.chatBox.scrollTop=this.elements.chatBox.scrollHeight

    return div

},


showMaria(){

    this.elements.mainVideo.style.display="block"

    this.elements.idleVideo.style.display="block"

},


setupIdleVideo(){

    const idle=this.elements.idleVideo

    idle.onended=()=>{

        if(this.state.queuedVid){

            const url=this.state.queuedVid

            this.state.queuedVid=null

            const vid=this.changeVid(url)

            idle.style.opacity="0"

            vid.style.opacity="1"

            vid.play()

            vid.onended=()=>{

                this.switchIdle()

            }

        }

        else{

            idle.currentTime=0

            idle.play()

        }

    }

},


switchIdle(){

    const video=this.elements.mainVideo

    const idle=this.elements.idleVideo

    video.pause()

    video.style.opacity="0"

    idle.currentTime=0

    idle.style.opacity="1"

    idle.play()

},


changeVid(url){

    const vid=this.elements.mainVideo

    vid.src=url

    vid.load()

    vid.currentTime=0

    return vid

},


getVideoUrlById(id){

    return this.config.AWS_videoURL_Base + String(id).padStart(3,"0") + ".mp4"

},


startOpioidPromptTimer(){

    this.state.opioidPromptIntervalId=setInterval(()=>{

        this.triggerOpioidPrompt()

    },this.config.opioidPromptIntervalMs)

},


triggerOpioidPrompt(){

    const videoURL=this.getVideoUrlById(this.config.opioidVideoId)

    this.appendMessage(this.config.opioidText,"bot")

    this.state.logData.push([
        "[SYSTEM TIMER]",
        this.config.opioidText,
        this.config.opioidVideoId
    ])

    this.state.queuedVid=videoURL

},


async sendMessage(){

    if(this.state.isSending)return

    const text=this.elements.userInput.value.trim()

    if(!text)return

    this.state.isSending=true

    this.appendMessage(text,"user")

    const botBubble=this.appendMessage("...","bot")

    this.elements.userInput.value=""

    try{

        const response=await fetch(
            this.config.ENDPOINT_URL+"JuanGomez/chat_exact",
            {
                method:"POST",
                headers:{"Content-Type":"application/json"},
                body:JSON.stringify({
                    message:text,
                    session_id:this.state.sessionId
                })
            }
        )

        const res=await response.json()

        const replyText=res.answer || "Sorry, I could not generate a response."

        const replyId=Number(res.answer_index)

        botBubble.textContent=this.formatChatMessage(replyText)

        if(replyId>=this.config.intentMinId && replyId<=this.config.intentMaxId){

            this.state.numUnfocusedQuestions=0

            const videoURL=this.getVideoUrlById(replyId)

            this.state.queuedVid=videoURL

        }

        else{

            await this.generateTTS(replyText)

            this.elements.audioPlayer.play()

            this.elements.audioPlayer.onended=()=>this.switchIdle()

            this.state.numUnfocusedQuestions++

        }

        this.state.logData.push([text,replyText,replyId])

        if(this.state.numUnfocusedQuestions>=3){

            this.elements.focusPopup.style.display="flex"

        }

    }

    catch(error){

        botBubble.textContent=this.formatChatMessage("Connection error")

        console.error(error)

    }

    finally{

        this.state.isSending=false

    }

},


async generateTTS(text){

    text=text.replace(/\([^)]*\)/g,"")

    const payload={
        text:text,
        language_code:"es-US",
        voice_name:"es-US-Chirp3-HD-Iapetus"
    }

    const response=await fetch(
        this.config.ENDPOINT_URL+"api/googlecloudtts",
        {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify(payload)
        }
    )

    const blob=await response.blob()

    const url=URL.createObjectURL(blob)

    this.elements.audioPlayer.src=url

},


setupSTT(){

    const mic=this.elements.micButton

    mic.addEventListener("click",()=>{

        if(!this.state.isRecording){

            this.startRecording()

        }

    })

},


async startRecording(){

    const stream=await navigator.mediaDevices.getUserMedia({audio:true})

    this.state.stream=stream

    const recorder=new MediaRecorder(stream)

    this.state.mediaRecorder=recorder

    this.state.audioChunks=[]

    recorder.ondataavailable=e=>{

        if(e.data.size>0){

            this.state.audioChunks.push(e.data)

        }

    }

    recorder.onstop=async()=>{

        const blob=new Blob(this.state.audioChunks,{type:recorder.mimeType})

        const formData=new FormData()

        formData.append("audio",blob,"recording.webm")

        formData.append("language_code","en")

        const response=await fetch(
            this.config.ENDPOINT_URL+"api/googlecloudstt",
            {
                method:"POST",
                body:formData
            }
        )

        const result=await response.json()

        this.elements.userInput.value=result.transcript

        this.sendMessage()

        stream.getTracks().forEach(t=>t.stop())

    }

    recorder.start()

    this.state.isRecording=true

    this.elements.micButton.innerHTML="⏳"

},


async createLogFile(){

    const formUrl="https://docs.google.com/forms/d/e/1FAIpQLSfPxO3FT8BRMBOmWop4U7ljOiOE5lnTIb3nqTPvoFwcKqJxxQ/formResponse"

    for(const row of this.state.logData){

        const formData=new FormData()

        formData.append("entry.413257006",row[0])
        formData.append("entry.253578126",row[1])
        formData.append("entry.329507193",row[2])

        await fetch(formUrl,{
            method:"POST",
            body:formData,
            mode:"no-cors"
        })

    }

},


async redirectPage(){

    await this.createLogFile()

    if(this.state.opioidPromptIntervalId){

        clearInterval(this.state.opioidPromptIntervalId)

    }

    const iframe=this.elements.outroIframe

    if(!iframe)return

    iframe.style.display="block"

    const video=iframe.contentWindow.document.getElementById("myVideo7")

    video.style.display="block"

    video.play()

}

}


document.addEventListener("DOMContentLoaded",()=>{

    App.init()

})
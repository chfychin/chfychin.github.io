try {
    //51.1a
    LA.init({ id: "3RRggZmqMoqDpfP0", ck: "3RRggZmqMoqDpfP0", hashMode: true });
    //需要把上述内容换成你的id和ck

    //灵雀应用监控
    new LingQue.Monitor().init({ id: "3RRgllbPPBbpaMAm", sendSpaPv: true });
    //这里同样换成你的id
} catch (err) { }

import React, { useState, useEffect } from "react";
import { io } from "socket.io-client";
import Navbar from "../../../components/Navbar/Navbar";
import Footer from "../../../components/Footer/Footer";
import styles from "./Asistenta.module.css";

const socket = io("http://localhost:5000"); // URL-ul backendului

export default function Asistenta() {
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState([]);

  useEffect(() => {
    socket.on("receive_message", (data) => {
      setChat((prev) => [...prev, data]);
    });

    return () => {
      socket.off("receive_message");
    };
  }, []);

  const sendMessage = () => {
    if (message.trim()) {
      const msgData = { text: message, sender: "Vânzător", time: new Date().toLocaleTimeString() };
      socket.emit("send_message", msgData);
      setMessage("");
    }
  };

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <h1>💬 Asistență tehnică</h1>
        <div className={styles.chatBox}>
          {chat.map((c, i) => (
            <div key={i} className={styles.message}>
              <strong>{c.sender}:</strong> {c.text} <span className={styles.time}>{c.time}</span>
            </div>
          ))}
        </div>
        <div className={styles.inputArea}>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Scrie un mesaj..."
          />
          <button onClick={sendMessage}>Trimite</button>
        </div>
      </div>
      <Footer />
    </>
  );
}

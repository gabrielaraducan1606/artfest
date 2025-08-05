import React, { useEffect, useState } from "react";
import Navbar from "../../../components/Navbar/Navbar";
import Footer from "../../../components/Footer/Footer";
import styles from "./Vizitatori.module.css";
import api from "../../../../api/api";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function Vizitatori() {
  const [stats, setStats] = useState(null);
  const [visitsData, setVisitsData] = useState([]);
  const [topProducts, setTopProducts] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem("authToken");
        const res = await api.get("/analytics/visitors", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setStats(res.data.stats);
        setVisitsData(res.data.dailyVisits);
        setTopProducts(res.data.topProducts);
      } catch (err) {
        console.error("❌ Eroare la încărcarea vizitatorilor:", err);
      }
    };
    fetchData();
  }, []);

  return (
    <>
      <Navbar />
      <div className={styles.container}>
        <h1 className={styles.title}>📊 Statistici vizitatori</h1>

        {stats && (
          <div className={styles.cards}>
            <div className={styles.card}>
              <h3>Total vizite</h3>
              <p>{stats.total}</p>
            </div>
            <div className={styles.card}>
              <h3>Vizite luna aceasta</h3>
              <p>{stats.thisMonth}</p>
            </div>
            <div className={styles.card}>
              <h3>Vizite azi</h3>
              <p>{stats.today}</p>
            </div>
          </div>
        )}

        <div className={styles.chartWrapper}>
          <h2>Evoluție vizite (ultimele 30 zile)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={visitsData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="visits" stroke="#C1E1C1" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className={styles.topProducts}>
          <h2>🏆 Top produse vizitate</h2>
          <ul>
            {topProducts.map((prod) => (
              <li key={prod._id}>
                <img src={prod.image} alt={prod.title} />
                <span>{prod.title}</span>
                <strong>{prod.visits} vizite</strong>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Footer />
    </>
  );
}

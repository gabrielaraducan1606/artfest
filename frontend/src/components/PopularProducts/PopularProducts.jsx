import React from "react";
import { Link } from "react-router-dom";
import Button from "../../components/ui/Button/Button";
import styles from "./PopularProducts.module.css";

const mockProducts = [
  { id: 1, name: "Invitație florală", price: "9.99 lei", image: "/mock/invitatie1.jpg" },
  { id: 2, name: "Mărturie lavandă", price: "5.50 lei", image: "/mock/marturie1.jpg" },
  { id: 3, name: "Cutie verighete", price: "29.00 lei", image: "/mock/cutie1.jpg" },
  { id: 4, name: "Lumânare botez", price: "45.00 lei", image: "/mock/lumanare1.jpg" },
];

export default function PopularProducts() {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Produse populare</h2>
      <div className={styles.grid}>
        {mockProducts.map((product) => (
          <div key={product.id} className={styles.card}>
            <img
              src={product.image}
              alt={product.name}
              className={styles.image}
            />
            <h3 className={styles.name}>{product.name}</h3>
            <p className={styles.price}>{product.price}</p>
            <Button className={styles.button}>Adaugă în coș</Button>
            <Link to={`/magazin/florina-art`} className={styles.link}>
              Vezi magazin
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}

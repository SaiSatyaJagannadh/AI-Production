// A short, deliberately vulnerable file so first-time visitors can see a report
// without hunting for Python of their own. Same flaws as ../../../airline.py.
export const SAMPLE_NAME = 'sample_vulnerable.py';

export const SAMPLE_CODE = `import sqlite3

DB = "prices.db"

def get_ticket_price(city):
    conn = sqlite3.connect(DB)
    cursor = conn.cursor()
    # user input pasted straight into SQL
    query = f"SELECT price FROM prices WHERE city = '{city.lower()}'"
    cursor.execute(query)
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else None

def calculate(expression):
    # evaluates whatever the user typed
    return eval(expression)

API_KEY = "sk-live-1234567890abcdef"

if __name__ == "__main__":
    city = input("City: ")
    print(get_ticket_price(city))
    print(calculate(input("Expression: ")))
`;

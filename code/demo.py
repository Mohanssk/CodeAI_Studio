def check_odd_even(number):
    if number % 2 == 0:
        return "Even"
    else:
        return "Odd"

num = int(input("Enter a number: "))
print(f"{num} is {check_odd_even(num)}")